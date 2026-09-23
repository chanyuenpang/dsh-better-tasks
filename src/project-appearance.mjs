import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { PROJECT_ICON_CATALOG, ICON_KEYS, CATALOG_REVISION } from './project-icon-catalog.mjs'

export { ICON_KEYS }
export const COLOR_KEYS = Object.freeze([
  'blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'yellow',
  'teal', 'indigo', 'amber', 'slate', 'black',
])

const iconKey = z.enum(ICON_KEYS)
const colorKey = z.enum(COLOR_KEYS)
const appearanceRecord = z.object({
  iconKey,
  colorKey,
  updatedAt: z.string(),
})

// Keep this exact name/version/table schema: it is the existing durable owner and
// allows Better Tasks to adopt the old package without migrating or copying data.
export const workspaceAppearanceDomain = defineDomain({
  name: 'workspace_appearance',
  version: 1,
  tables: { appearances: domainTable(appearanceRecord) },
})

function appearanceError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function sendAppearanceJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

async function readAppearanceJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw appearanceError('project-appearance/request-too-large', 'request body exceeds 64 KiB')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw appearanceError('project-appearance/invalid-json', 'request body must be valid JSON')
  }
}

export function createProjectAppearanceHttpHandler(registry) {
  return async (req, res) => {
    try {
      if (req.method === 'GET') {
        return sendAppearanceJson(res, 200, {
          items: registry.list(),
          iconKeys: ICON_KEYS,
          colorKeys: COLOR_KEYS,
          catalogRevision: CATALOG_REVISION,
          icons: PROJECT_ICON_CATALOG,
        })
      }
      if (req.method !== 'PUT') return sendAppearanceJson(res, 405, { code: 'method-not-allowed' })
      const input = await readAppearanceJson(req)
      const value = await registry.set(input.workspaceId, input)
      return sendAppearanceJson(res, 200, { item: value })
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'project-appearance/write-failed'
      const status = code === 'project-appearance/workspace-not-found' ? 404 : code === 'project-appearance/request-too-large' ? 413 : 400
      return sendAppearanceJson(res, status, { code, message: String(error?.message ?? error) })
    }
  }
}

export async function installProjectAppearance(ctx) {
  const domain = await ctx.storageDomain.open(workspaceAppearanceDomain)
  const table = domain.table('appearances')
  let closed = false

  const workspaceIds = new Set(ctx.workspaceRegistry.list().map((workspace) => String(workspace.id)))
  for (const workspaceId of table.keys()) {
    if (!workspaceIds.has(String(workspaceId))) await table.delete(workspaceId)
  }

  const registry = Object.freeze({
    iconKeys: ICON_KEYS,
    colorKeys: COLOR_KEYS,
    get(workspaceId) {
      return table.get(String(workspaceId))
    },
    list() {
      return [...table.entries()].map(([workspaceId, appearance]) => ({
        workspaceId: String(workspaceId),
        iconKey: appearance.iconKey,
        colorKey: appearance.colorKey,
        updatedAt: appearance.updatedAt,
      }))
    },
    async set(workspaceId, next) {
      const id = String(workspaceId)
      if (ctx.workspaceRegistry.get(id) === undefined) {
        throw appearanceError('project-appearance/workspace-not-found', `project-appearance/workspace-not-found: ${id}`)
      }
      const parsed = appearanceRecord.safeParse({
        iconKey: next?.iconKey,
        colorKey: next?.colorKey,
        updatedAt: new Date().toISOString(),
      })
      if (!parsed.success) {
        throw appearanceError('project-appearance/invalid-appearance', 'project-appearance/invalid-appearance', {
          iconKey: next?.iconKey,
          colorKey: next?.colorKey,
        })
      }
      await table.put(id, parsed.data)
      return { workspaceId: id, ...parsed.data }
    },
    async remove(workspaceId) {
      return table.delete(String(workspaceId))
    },
  })

  ctx.provide('projectAppearanceRegistry', registry)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/project-appearance',
    handler: createProjectAppearanceHttpHandler(registry),
  }), 'dsh-better-tasks.project-appearance-http')
  ctx.on('domain/changed', (change) => {
    if (closed || change.domain !== 'workspace' || change.table !== 'workspaces' || change.operation !== 'deleted') return
    registry.remove(change.key).catch((error) => {
      ctx.logger.warn(`project appearance cleanup failed for deleted workspace '${change.key}': ${String(error)}`)
    })
  })
  ctx.effect(() => async () => {
    closed = true
    await domain.close()
  }, 'dsh-better-tasks.project-appearance-domain-close')

  return registry
}
