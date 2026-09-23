import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createProjectAppearanceHttpHandler, ICON_KEYS, COLOR_KEYS } from '../src/project-appearance.mjs'

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  return req
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    end(value = '') { this.body += value },
  }
}

test('integrated project appearance GET returns the durable registry and full catalog contract', async () => {
  const item = { workspaceId: 'workspace-1', iconKey: 'building', colorKey: 'yellow', updatedAt: '2026-09-23T00:00:00.000Z' }
  const handler = createProjectAppearanceHttpHandler({ list: () => [item] })
  const res = response()
  await handler(request('GET'), res)
  const body = JSON.parse(res.body)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(body.items, [item])
  assert.deepEqual(body.iconKeys, ICON_KEYS)
  assert.deepEqual(body.colorKeys, COLOR_KEYS)
  assert.equal(body.catalogRevision, 'tabler-3.44.0-r2')
  assert.equal(body.icons.length, ICON_KEYS.length)
  assert.ok(body.icons.length > 100)
})

test('integrated project appearance PUT delegates validation and persistence to its registry', async () => {
  const calls = []
  const saved = { workspaceId: 'workspace-1', iconKey: 'building', colorKey: 'yellow', updatedAt: '2026-09-23T00:00:00.000Z' }
  const handler = createProjectAppearanceHttpHandler({
    list: () => [],
    async set(workspaceId, value) { calls.push({ workspaceId, value }); return saved },
  })
  const res = response()
  await handler(request('PUT', { workspaceId: 'workspace-1', iconKey: 'building', colorKey: 'yellow' }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), { item: saved })
  assert.deepEqual(calls, [{ workspaceId: 'workspace-1', value: { workspaceId: 'workspace-1', iconKey: 'building', colorKey: 'yellow' } }])
})

test('Better Tasks owns the original workspace_appearance domain and endpoint', async () => {
  const [host, appearance] = await Promise.all([
    readFile(new URL('../src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/project-appearance.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(host, /import \{ installProjectAppearance \} from '\.\/project-appearance\.mjs'/)
  assert.match(host, /await installProjectAppearance\(ctx\)/)
  assert.match(appearance, /name: 'workspace_appearance',[\s\S]*?version: 1,[\s\S]*?appearances: domainTable\(appearanceRecord\)/)
  assert.match(appearance, /path: '\/api\/project-appearance'/)
  assert.match(appearance, /ctx\.provide\('projectAppearanceRegistry', registry\)/)
})

test('integrated project appearance preserves stable owner errors', async () => {
  const handler = createProjectAppearanceHttpHandler({
    list: () => [],
    async set() {
      const error = new Error('missing')
      error.code = 'project-appearance/workspace-not-found'
      throw error
    },
  })
  const res = response()
  await handler(request('PUT', { workspaceId: 'missing', iconKey: 'building', colorKey: 'yellow' }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(JSON.parse(res.body), { code: 'project-appearance/workspace-not-found', message: 'missing' })
})
