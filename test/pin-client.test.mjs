import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskPinsClient, projectNativeTaskQueue } from '../src/pin-client.mjs'
const queue = (revision, sessionIds) => ({ schemaVersion: 1, revision, sessionIds, updatedAt: `r${revision}` })
const reply = (status, payload) => ({ response: { ok: status >= 200 && status < 300, status }, payload })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function fixture(pins = ['a'], order = pins) {
  let snapshot = { pinnedSessionIds: pins, archivedSessionIds: [], phase: 'ready', state: 'idle', error: null }
  const listeners = new Set(), requests = [], calls = [], timers = new Map()
  let timerId = 0
  const native = { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const set = patch => { snapshot = { ...snapshot, ...patch }; for (const fn of [...listeners]) fn() }
  const f = { native, set, listeners, requests, calls, timers,
    request: async () => reply(200, { queue: queue(2, order) }),
    pin: async id => set({ pinnedSessionIds: [id, ...snapshot.pinnedSessionIds.filter(x => x !== id)] }),
    unpin: async id => set({ pinnedSessionIds: snapshot.pinnedSessionIds.filter(x => x !== id) }),
  }
  f.client = createTaskPinsClient({ request: (...args) => { requests.push(args); return f.request(...args) },
    schedule(fn) { const id = ++timerId; timers.set(id, fn); return id }, cancel(id) { timers.delete(id) } })
  f.off = f.client.connectNative({ source: native,
    pinSession: id => { calls.push(['pin', id]); return f.pin(id) },
    unpinSession: id => { calls.push(['unpin', id]); return f.unpin(id) } })
  f.ids = () => f.client.source.getSnapshot().queue.sessionIds
  return f
}

test('rank projection intersects official pins, excludes archives, and never resurrects legacy membership', () => {
  const rank = queue(4, ['gone', 'b', 'a'])
  assert.deepEqual(projectNativeTaskQueue(rank, { pinnedSessionIds: ['c', 'a', 'b'], archivedSessionIds: ['a'] }).sessionIds, ['b', 'c'])
  assert.deepEqual(rank.sessionIds, ['gone', 'b', 'a'])
})
test('native pin ack changes task membership, not an optimistic second collection or HTTP pin request', async () => {
  const f = fixture(), gate = deferred(); f.pin = () => gate.promise
  await f.client.refresh()
  const work = f.client.setPinned('b', true)
  assert.deepEqual(f.ids(), ['a']); assert.deepEqual(f.client.source.getSnapshot().pendingSessionIds, ['b'])
  await flush(); assert.deepEqual(f.calls, [['pin', 'b']])
  f.set({ pinnedSessionIds: ['b', 'a'] }); gate.resolve(); await work
  assert.deepEqual(f.ids(), ['a', 'b']); assert.deepEqual(f.client.source.getSnapshot().pendingSessionIds, [])
  assert.ok(f.requests.every(([method]) => method === 'GET'))
})
test('native follow updates across windows immediately and stale order cannot re-pin', async () => {
  const f = fixture(['b', 'a'], ['a', 'b']); await f.client.refresh()
  f.set({ pinnedSessionIds: ['c', 'b'] }); assert.deepEqual(f.ids(), ['b', 'c'])
  await f.client.refresh(); assert.deepEqual(f.ids(), ['b', 'c'])
  f.set({ archivedSessionIds: ['b'] }); assert.deepEqual(f.ids(), ['c'])
})
test('failed unpin clears only pending and retains latest native state without inverse mutation', async () => {
  const f = fixture(), gate = deferred(); f.unpin = () => gate.promise
  const work = f.client.setPinned('a', false)
  assert.deepEqual(f.ids(), ['a'])
  f.set({ pinnedSessionIds: ['c', 'a'] }); gate.reject(new Error('offline'))
  await assert.rejects(work, /offline/)
  assert.deepEqual(f.ids(), ['c', 'a']); assert.deepEqual(f.calls, [['unpin', 'a']])
  assert.deepEqual(f.client.source.getSnapshot().pendingSessionIds, [])
  assert.equal(f.client.source.getSnapshot().error, 'offline')
})
test('an error after native membership committed cannot roll back the pin', async () => {
  const f = fixture([]); f.pin = async id => { f.set({ pinnedSessionIds: [id] }); throw new Error('local view order failed') }
  await assert.rejects(f.client.pinCreated('blank'), /local view order failed/)
  assert.deepEqual(f.ids(), ['blank']); assert.deepEqual(f.calls, [['pin', 'blank']])
})
test('new blank auto-pin uses the same native action and repeated reuse is idempotent', async () => {
  const f = fixture([])
  await f.client.pinCreated('blank'); await f.client.pinCreated('blank')
  assert.deepEqual(f.calls, [['pin', 'blank']]); assert.deepEqual(f.ids(), ['blank'])
})
test('same-id overlapping actions keep pending until both settle; identical in-flight action coalesces', async () => {
  const f = fixture([]), pin = deferred(), unpin = deferred()
  f.pin = () => pin.promise; f.unpin = () => unpin.promise
  const first = f.client.setPinned('a', true)
  assert.equal(f.client.setPinned('a', true), first)
  const second = f.client.setPinned('a', false)
  await flush(); pin.resolve(); await first
  assert.deepEqual(f.client.source.getSnapshot().pendingSessionIds, ['a'])
  unpin.resolve(); await second
  assert.deepEqual(f.client.source.getSnapshot().pendingSessionIds, [])
  assert.deepEqual(f.ids(), [])
})
test('native reconnect loading/error retains last confirmed pins and manual rank', async () => {
  const f = fixture(['a', 'b'], ['b', 'a']); await f.client.refresh()
  f.set({ state: 'loading' }); assert.deepEqual(f.ids(), ['b', 'a'])
  f.set({ state: 'error', error: { message: 'reconnecting' } }); assert.deepEqual(f.ids(), ['b', 'a'])
  assert.equal(f.client.source.getSnapshot().error, 'reconnecting')
  f.set({ state: 'idle', error: null, pinnedSessionIds: ['b', 'a'] }); assert.deepEqual(f.ids(), ['b', 'a'])
})
test('manual order uses CAS and one conflict retry, without changing native pin order', async () => {
  const f = fixture(['a', 'b']); let writes = 0
  f.request = async (method, command) => {
    if (method === 'GET') return reply(200, { queue: queue(1, ['a', 'b']) })
    writes++; assert.equal(command.action, 'move'); assert.equal(command.expectedRevision, writes)
    return writes === 1 ? reply(409, { queue: queue(2, ['a', 'b']) }) : reply(200, { queue: queue(3, ['b', 'a']) })
  }
  await f.client.refresh(); await f.client.moveBefore('b', 'a')
  assert.equal(writes, 2); assert.deepEqual(f.ids(), ['b', 'a']); assert.deepEqual(f.native.getSnapshot().pinnedSessionIds, ['a', 'b']); assert.deepEqual(f.calls, [])
})
test('reorder never accepts a removed native member or loops on persistent conflict', async () => {
  const f = fixture(['a', 'b']); await f.client.refresh(); f.set({ pinnedSessionIds: ['a'] })
  await assert.rejects(f.client.moveBefore('b', 'a'), /no longer pinned/)
  f.set({ pinnedSessionIds: ['a', 'b'] })
  let writes = 0; f.request = async () => { writes++; return reply(409, { queue: queue(2 + writes, ['a', 'b']) }) }
  await assert.rejects(f.client.moveBefore('b', 'a'), /changed again/); assert.equal(writes, 2)
})
test('migration read-only status disables reorder and polls only while active, then cleans up', async () => {
  const f = fixture(); f.request = async () => reply(200, { queue: queue(1, ['a']), writable: false,
    migration: { status: 'running' }, warnings: ['Importing earlier tasks'] })
  const stop = f.client.start(); await flush()
  assert.equal(f.client.source.getSnapshot().writable, false); assert.equal(f.timers.size, 1)
  await assert.rejects(f.client.moveBefore('a'), /not ready/)
  f.request = async () => reply(200, { queue: queue(2, ['a']), writable: true, migration: { status: 'done' } })
  await f.client.refresh(); assert.equal(f.client.source.getSnapshot().writable, true); assert.equal(f.timers.size, 0)
  stop(); assert.equal(f.listeners.size, 0); await assert.rejects(f.client.setPinned('a', false), /unavailable/)
})
test('lazy initializing fallback does not erase an already known manual rank on reconnect', async () => {
  const f = fixture(['a', 'b'], ['b', 'a']); await f.client.refresh()
  f.request = async () => reply(200, { queue: queue(0, ['a', 'b']), migration: { status: 'initializing' }, writable: false })
  await f.client.refresh(); assert.deepEqual(f.ids(), ['b', 'a']); assert.equal(f.client.source.getSnapshot().writable, false)
  f.set({ pinnedSessionIds: ['a'] }); assert.deepEqual(f.ids(), ['a'])
})

test('stale HTTP response during unpin cannot restore membership', async () => {
  const f = fixture(['a']), read = deferred(); f.request = () => read.promise
  const pending = f.client.refresh(); await flush(); f.set({ pinnedSessionIds: [] })
  read.resolve(reply(200, { queue: queue(2, ['a']) })); await pending
  assert.deepEqual(f.ids(), [])
})
test('invalid order response fails locally without clearing confirmed native pins', async () => {
  const f = fixture(['a']); f.request = async () => reply(200, { queue: {} })
  await assert.rejects(f.client.refresh(), /invalid task order/)
  assert.deepEqual(f.ids(), ['a']); assert.equal(f.client.source.getSnapshot().writable, false)
})
test('missing native provider stays a local feature failure and makes no HTTP or mutation calls', async () => {
  let requests = 0
  const client = createTaskPinsClient({ request: () => { requests++; throw new Error('unexpected') } })
  const off = client.connectNative({}); assert.equal(typeof off, 'function')
  await client.refresh(); await assert.rejects(client.pinCreated('a'), /unavailable/)
  assert.equal(requests, 0); assert.deepEqual(client.source.getSnapshot().queue.sessionIds, [])
  assert.match(client.source.getSnapshot().error, /unavailable/)
})
