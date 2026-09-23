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

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
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

test('pin intent publishes immediately even while a refresh owns the request tail', async () => {
  const originalFetch = globalThis.fetch
  const readGate = deferred()
  const writeGate = deferred()
  let command
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') return readGate.promise
    command = JSON.parse(options.body)
    return writeGate.promise
  }
  try {
    const client = createTaskPinsClient()
    const refreshing = client.refresh()
    const pinning = client.setPinned('b', true)
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['b'])
    assert.deepEqual(client.source.getSnapshot().pendingSessionIds, ['b'])

    readGate.resolve(response(200, { queue: queue(2, ['a']) }))
    await refreshing
    await Promise.resolve()
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'b'])
    assert.deepEqual(command, { action: 'pin', sessionId: 'b', expectedRevision: 2 })

    writeGate.resolve(response(200, { queue: queue(3, ['a', 'b']) }))
    await pinning
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'b'])
    assert.deepEqual(client.source.getSnapshot().pendingSessionIds, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('failed unpin rolls its optimistic projection back to the confirmed Host queue', async () => {
  const originalFetch = globalThis.fetch
  const writeGate = deferred()
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') return response(200, { queue: queue(1, ['a']) })
    return writeGate.promise
  }
  try {
    const client = createTaskPinsClient()
    await client.refresh()
    const unpinning = client.setPinned('a', false)
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, [])
    assert.deepEqual(client.source.getSnapshot().pendingSessionIds, ['a'])

    writeGate.resolve(response(500, { message: 'write failed' }))
    await assert.rejects(unpinning, /write failed/)
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a'])
    assert.deepEqual(client.source.getSnapshot().pendingSessionIds, [])
    assert.equal(client.source.getSnapshot().error, 'write failed')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('different optimistic pins render together while Host CAS writes stay serial', async () => {
  const originalFetch = globalThis.fetch
  const writeGates = [deferred(), deferred()]
  const commands = []
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') return response(200, { queue: queue(1, ['a']) })
    const index = commands.length
    commands.push(JSON.parse(options.body))
    return writeGates[index].promise
  }
  try {
    const client = createTaskPinsClient()
    await client.refresh()
    const pinB = client.setPinned('b', true)
    const pinC = client.setPinned('c', true)
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'b', 'c'])
    assert.deepEqual(client.source.getSnapshot().pendingSessionIds, ['b', 'c'])
    await Promise.resolve()
    assert.equal(commands.length, 1)
    assert.equal(commands[0].expectedRevision, 1)

    writeGates[0].resolve(response(200, { queue: queue(2, ['a', 'b']) }))
    await pinB
    await Promise.resolve()
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'b', 'c'])
    assert.equal(commands.length, 2)
    assert.equal(commands[1].expectedRevision, 2)

    writeGates[1].resolve(response(200, { queue: queue(3, ['a', 'b', 'c']) }))
    await pinC
    assert.deepEqual(client.source.getSnapshot().queue.sessionIds, ['a', 'b', 'c'])
    assert.deepEqual(client.source.getSnapshot().pendingSessionIds, [])
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
