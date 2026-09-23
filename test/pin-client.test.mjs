import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskPinsClient } from '../src/pin-client.mjs'

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload },
  }
}

function queue(revision, sessionIds) {
  return { schemaVersion: 1, revision, sessionIds, updatedAt: `r${revision}` }
}

test('pin client adopts Host snapshots and sends revision-CAS mutations', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(options)
    if ((options.method ?? 'GET') === 'GET') return response(200, { queue: queue(2, ['a']) })
    return response(200, { queue: queue(3, ['a', 'b']) })
  }
  try {
    const client = createTaskPinsClient()
    await client.refresh()
    await client.setPinned('b', true)
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'b'])
    assert.deepEqual(JSON.parse(requests[1].body), {
      action: 'pin',
      sessionId: 'b',
      expectedRevision: 2,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('created-session pin uses the dedicated blank-session command', async () => {
  const originalFetch = globalThis.fetch
  let command
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') return response(200, { queue: queue(0, []) })
    command = JSON.parse(options.body)
    return response(200, { queue: queue(1, ['blank']) })
  }
  try {
    const client = createTaskPinsClient()
    await client.refresh()
    await client.pinCreated('blank')
    assert.deepEqual(command, { action: 'pin-created', sessionId: 'blank', expectedRevision: 0 })
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['blank'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pin client adopts a 409 queue and retries the intended state once', async () => {
  const originalFetch = globalThis.fetch
  let writes = 0
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') return response(200, { queue: queue(1, ['a']) })
    writes += 1
    const command = JSON.parse(options.body)
    if (writes === 1) {
      assert.equal(command.expectedRevision, 1)
      return response(409, { code: 'better-tasks/revision-conflict', queue: queue(2, ['a', 'c']) })
    }
    assert.equal(command.expectedRevision, 2)
    return response(200, { queue: queue(3, ['a', 'c', 'b']) })
  }
  try {
    const client = createTaskPinsClient()
    await client.refresh()
    await client.setPinned('b', true)
    assert.equal(writes, 2)
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'c', 'b'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pin client treats already satisfied desired state as an idempotent no-op', async () => {
  const originalFetch = globalThis.fetch
  let writes = 0
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') return response(200, { queue: queue(1, ['a']) })
    writes += 1
    return response(500, {})
  }
  try {
    const client = createTaskPinsClient()
    await client.refresh()
    await client.setPinned('a', true)
    assert.equal(writes, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
