import { Buffer } from 'node:buffer'
import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  PIN_QUEUE_SCHEMA_VERSION,
  PinQueueError,
  publicPinQueue,
} from './pin-model.mjs'
import { installProjectAppearance } from './project-appearance.mjs'
import { createFinalMessageHttpHandler } from './final-message.mjs'
import { createNativePinHost } from './native-pin-host.mjs'
import { createTaskExecutionProjection } from './task-execution.mjs'

export const name = 'dsh-better-tasks'
export const inject = ['storageDomain', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'webServer']
export const TASK_SETTINGS_NAMESPACE = 'better-tasks-ui'
export const TASK_SETTINGS_DEFAULTS = Object.freeze({
  detailFontSize: 13,
  defaultTodoExpanded: false,
  defaultGoalExpanded: false,
  defaultFinalExpanded: true,
  defaultInputExpanded: false,
  columnLayout: 'auto',
  titleEmphasis: 'project',
  sidebarView: 'native',
})
export const TaskSettingsSchema = Schema.object({
  // 0.2 exposes only volatile Config fields through settings.describe/forms.
  // Its .volatile() is exactly .extra('volatile', true); use that public metadata
  // API so the retained 0.1.5 build-time Schemastery can parse the same schema.
  detailFontSize: Schema.number().step(1).min(11).max(16).default(13).extra('volatile', true),
  defaultTodoExpanded: Schema.boolean().default(false).extra('volatile', true),
  defaultGoalExpanded: Schema.boolean().default(false).extra('volatile', true),
  defaultFinalExpanded: Schema.boolean().default(true).extra('volatile', true),
  defaultInputExpanded: Schema.boolean().default(false).extra('volatile', true),
  columnLayout: Schema.union(['auto', 'single', 'double']).default('auto').extra('volatile', true),
  titleEmphasis: Schema.union(['project', 'task']).default('project').extra('volatile', true),
  // D1: the sidebar body the browser shows. Host-persisted, so both generations
  // read and write it through the same Config path.
  sidebarView: Schema.union(['native', 'tasks']).default('native').extra('volatile', true),
})

/**
 * The plugin's own Config schema.
 *
 * 0.2 derives both the settings form and the persistence namespace from a plugin's
 * entry: the namespace is the loader entry id and the fields are this schema's
 * keys, so the seven preference fields have to live here. The 0.1.5 runtime entry
 * point `settings.register(namespace, schema)` does not exist in 0.2 — calling it
 * threw inside a non-blocking inject callback, which is exactly why preferences
 * never persisted and nothing reported itself as broken.
 *
 * {@link TASK_SETTINGS_NAMESPACE} is therefore both the 0.1.5 namespace and the
 * required 0.2 row id: under the same name the values 0.1.5 wrote are read in
 * place and a rollback loses nothing, so no copy migration is needed. A row named
 * anything else starts at these defaults and leaves the legacy key untouched.
 */
export const Config = TaskSettingsSchema

const pinQueueRecord = z.object({
  schemaVersion: z.literal(PIN_QUEUE_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  sessionIds: z.array(z.string().min(1)).refine((items) => new Set(items).size === items.length, 'sessionIds must be unique'),
  updatedAt: z.string().min(1),
})

export const pinQueueDomain = defineDomain({
  name: 'better_tasks_pin_queue',
  version: 1,
  tables: { queues: domainTable(pinQueueRecord) },
})

// A new unit, not a field/table extension of the rollback-readable legacy queue.
export const nativePinOrderDomain = defineDomain({
  name: 'better_tasks_native_order', version: 1,
  tables: { state: domainTable(pinQueueRecord.extend({
    migration: z.object({
      status: z.enum(['running', 'done', 'partial']),
      sourceRevision: z.number().int().nonnegative().nullable(),
      entries: z.array(z.object({
        sessionId: z.string().min(1),
        status: z.enum(['pending', 'attempted', 'imported', 'skipped', 'failed', 'uncertain']),
        detail: z.string().optional(),
      })),
    }),
  })) },
})

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new PinQueueError('better-tasks/request-too-large', 'request body exceeds 64 KiB')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PinQueueError('better-tasks/invalid-json', 'request body must be valid JSON')
  }
}

function errorStatus(error) {
  if (error?.code === 'better-tasks/revision-conflict') return 409
  if (error?.code === 'better-tasks/session-not-eligible') return 404
  if (error?.code === 'better-tasks/request-too-large') return 413
  if (typeof error?.code === 'string' && error.code.startsWith('better-tasks/')) return 400
  return 500
}

export function createPinQueueHttpHandler({ current, eligibleSessionIds, retainedSessionIds = eligibleSessionIds, mutate, prune }) {
  return async (req, res) => {
    try {
      if (req.method === 'GET') {
        const retained = await retainedSessionIds()
        return sendJson(res, 200, { queue: publicPinQueue(await prune(retained)) })
      }
      if (req.method !== 'POST') return sendJson(res, 405, { code: 'method-not-allowed' })
      const input = await readJson(req)
      if (input?.action === 'pin' || input?.action === 'pin-created') {
        const eligible = input.action === 'pin-created' ? await retainedSessionIds() : await eligibleSessionIds()
        if (!eligible.has(input.sessionId)) {
          throw new PinQueueError('better-tasks/session-not-eligible', `session is not eligible for pinning: ${String(input.sessionId)}`)
        }
      }
      const queue = await mutate(input)
      return sendJson(res, 200, { queue: publicPinQueue(queue) })
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'better-tasks/write-failed'
      return sendJson(res, errorStatus(error), {
        code,
        message: String(error?.message ?? error),
        ...(error?.details === undefined ? {} : { details: error.details }),
        ...(code === 'better-tasks/revision-conflict' ? { queue: publicPinQueue(current()) } : {}),
      })
    }
  }
}

export function createNativePinHttpHandler(controller) {
  return async (req, res) => {
    try {
      if (req.method === 'GET') return sendJson(res, 200, controller.read())
      if (req.method !== 'POST') return sendJson(res, 405, { code: 'method-not-allowed' })
      return sendJson(res, 200, await controller.mutate(await readJson(req)))
    } catch (error) {
      const status = error?.status ?? (error?.name === 'WorkspaceUnknownSessionError' ? 404 : error?.name === 'WorkspaceArchivedSessionPinError' ? 400 : errorStatus(error))
      return sendJson(res, status, { ...controller.current(), code: error?.code ?? 'better-tasks/write-failed', message: String(error?.message ?? error) })
    }
  }
}

export async function apply(ctx) {
  // Optional projection capability must never hold core-shell activation.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createTaskExecutionProjection(z))
  })
  ctx.inject(['settings'], (settingsCtx) => {
    // 0.1.5: the Host settings service accepted a runtime namespace registration.
    if (typeof settingsCtx.settings.register === 'function') {
      settingsCtx.settings.register(TASK_SETTINGS_NAMESPACE, TaskSettingsSchema)
      return
    }
    // 0.2: the schema comes from `Config` above, so the only thing left to declare
    // is the instance-level UI policy, attributed to this plugin's fiber.
    if (typeof settingsCtx.settings.configure === 'function') {
      settingsCtx.effect(
        () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
        'dsh-better-tasks: settings presentation',
      )
    }
  })
  await installProjectAppearance(ctx)
  // No migration/storage wait in plugin startup. Native controls are independent
  // of this optional ordering feature; the first feature request starts its work.
  const open = async (spec, tableName) => {
    const domain = await ctx.storageDomain.open(spec)
    return { table: domain.table(tableName), close: () => domain.close() }
  }
  const controller = createNativePinHost({
    registry: ctx.workspaceRegistry,
    openOrder: () => open(nativePinOrderDomain, 'state'),
    openLegacy: () => open(pinQueueDomain, 'queues'),
    subscribe: listener => ctx.on('domain/changed', listener),
  })
  const handler = createNativePinHttpHandler(controller)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/better-tasks/pins',
    handler,
  }), 'dsh-better-tasks.pin-http')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/better-tasks/final-message',
    handler: createFinalMessageHttpHandler({
      isPinned: (sessionId) => ctx.workspaceRegistry.pinnedSessionIds.includes(String(sessionId)),
      readSession: (sessionId) => ctx.sessionQuery.readSession(sessionId),
    }),
  }), 'dsh-better-tasks.final-message-http')
  ctx.effect(() => async () => {
    await controller.dispose()
  }, 'dsh-better-tasks.native-pin-controller-close')
}
