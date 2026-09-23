import { Buffer } from 'node:buffer'
import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  PIN_QUEUE_KEY,
  PIN_QUEUE_SCHEMA_VERSION,
  PinQueueError,
  applyPinCommand,
  createEmptyPinQueue,
  prunePinQueue,
  publicPinQueue,
} from './pin-model.mjs'
import { installProjectAppearance } from './project-appearance.mjs'
import { createFinalMessageHttpHandler } from './final-message.mjs'

export const name = 'dsh-better-tasks'
export const inject = ['storageDomain', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'webServer']
export const TASK_SETTINGS_NAMESPACE = 'better-tasks-ui'
export const TASK_SETTINGS_DEFAULTS = Object.freeze({
  detailFontSize: 13,
  defaultTodoExpanded: false,
  defaultGoalExpanded: false,
  defaultFinalExpanded: true,
  columnLayout: 'auto',
})
export const TaskSettingsSchema = Schema.object({
  detailFontSize: Schema.number().step(1).min(11).max(16).default(13),
  defaultTodoExpanded: Schema.boolean().default(false),
  defaultGoalExpanded: Schema.boolean().default(false),
  defaultFinalExpanded: Schema.boolean().default(true),
  columnLayout: Schema.union(['auto', 'single', 'double']).default('auto'),
})

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

export async function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(TASK_SETTINGS_NAMESPACE, TaskSettingsSchema)
  })
  await installProjectAppearance(ctx)
  const domain = await ctx.storageDomain.open(pinQueueDomain)
  const queues = domain.table('queues')
  if (queues.get(PIN_QUEUE_KEY) === undefined) await queues.put(PIN_QUEUE_KEY, createEmptyPinQueue())

  const current = () => {
    const queue = queues.get(PIN_QUEUE_KEY)
    if (queue === undefined) throw new PinQueueError('better-tasks/missing-record', 'pin queue record is unavailable')
    return queue
  }

  const sessionEligibility = async () => {
    const value = await ctx.sessionController.list({}, new AbortController().signal)
    const archived = new Set(ctx.workspaceRegistry.archivedSessionIds.map(String))
    const retained = value.items
      .filter((session) => session.origin !== 'subagent' && !archived.has(String(session.sessionId)))
    return {
      eligible: new Set(retained.filter((session) => !session.blank).map((session) => String(session.sessionId))),
      retained: new Set(retained.map((session) => String(session.sessionId))),
    }
  }
  const eligibleSessionIds = async () => (await sessionEligibility()).eligible
  const retainedSessionIds = async () => (await sessionEligibility()).retained

  const prune = async (eligible) => {
    const observed = current()
    if (prunePinQueue(observed, eligible) === observed) return observed
    return queues.update(PIN_QUEUE_KEY, (queue) => prunePinQueue(queue, eligible))
  }
  const mutate = async (command) => queues.update(PIN_QUEUE_KEY, (queue) => applyPinCommand(queue, command))
  const handler = createPinQueueHttpHandler({ current, eligibleSessionIds, retainedSessionIds, mutate, prune })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/better-tasks/pins',
    handler,
  }), 'dsh-better-tasks.pin-http')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/better-tasks/final-message',
    handler: createFinalMessageHttpHandler({
      isPinned: (sessionId) => current().sessionIds.includes(String(sessionId)),
      readSession: (sessionId) => ctx.sessionQuery.readSession(sessionId),
    }),
  }), 'dsh-better-tasks.final-message-http')
  ctx.effect(() => async () => {
    await domain.close()
  }, 'dsh-better-tasks.pin-domain-close')
}
