import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { createNativePinHost } from '../src/native-pin-host.mjs'
import { createNativePinHttpHandler, nativePinOrderDomain, pinQueueDomain } from '../src/index.js'

const clone = value => value === undefined ? undefined : structuredClone(value)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const legacyQueue = ids => ({ schemaVersion: 1, revision: 7, sessionIds: ids, updatedAt: 'legacy' })
const savedOrder = (ids, status = 'done', entries = []) => ({ ...legacyQueue(ids), migration: { status, sourceRevision: 7, entries } })
function bench({ pins = [], archived = [], legacy = legacyQueue([]), existing, beforeWrite, openFailure, pinFailure } = {}) {
  const listeners = new Set(), calls = [], writes = [], closes = [], records = new Map()
  if (existing) records.set('global', clone(existing))
  let cachedPins = [...pins], cachedArchived = [...archived], opens = 0, legacyOpens = 0, tick = 0
  const registry = {
    get pinnedSessionIds() { return cachedPins }, get archivedSessionIds() { return cachedArchived },
    async pinSession(id) {
      calls.push(['pin', id])
      if (pinFailure) await pinFailure(id)
      if (cachedPins.includes(id)) return
      if (cachedArchived.includes(id)) throw Object.assign(new Error('archived'), { name: 'WorkspaceArchivedSessionPinError' })
      if (id.startsWith('missing')) throw Object.assign(new Error('unknown Session'), { name: 'WorkspaceUnknownSessionError' })
      native([id, ...cachedPins], cachedArchived)
    },
    async unpinSession(id) { calls.push(['unpin', id]); native(cachedPins.filter(value => value !== id), cachedArchived) },
  }
  const native = (nextPins, nextArchived = cachedArchived, during) => {
    const event = { domain: 'workspace', table: '', key: '', operation: 'put', value: { initialized: true, workspaceIds: [], pinnedSessionIds: [...nextPins], archivedSessionIds: [...nextArchived] } }
    for (const listener of [...listeners]) listener(event)
    during?.() // registry getters deliberately still expose the OLD cache here.
    cachedPins = [...nextPins]; cachedArchived = [...nextArchived]
  }
  const table = {
    get: id => records.get(id),
    async put(id, value) { await beforeWrite?.(clone(value), writes.length); records.set(id, clone(value)); writes.push(clone(value)) },
    async update(id, fn) { return this.put(id, fn(records.get(id))).then(() => records.get(id)) },
  }
  const host = createNativePinHost({ registry, now: () => `t${++tick}`,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    openOrder: async () => { opens++; if (openFailure) throw openFailure; return { table, close: async () => { closes.push('order') } } },
    openLegacy: async () => { legacyOpens++; return { table: { get: () => legacy, put() { throw Error('legacy writes forbidden') }, update() { throw Error('legacy writes forbidden') } }, close: async () => { closes.push('legacy') } } },
  })
  return { host, registry, native, calls, writes, closes, records, listeners, get opens() { return opens }, get legacyOpens() { return legacyOpens } }
}
async function ready(b) { b.host.read(); await b.host.settled(); return b.host.current() }

 test('feature initialization is lazy and GET immediately exposes only official membership', async () => {
  const wait = deferred(), b = bench({ pins: ['native'], legacy: legacyQueue(['legacy']), beforeWrite: async (_, count) => { if (count === 0) await wait.promise } })
  assert.equal(b.opens, 0); assert.equal(b.calls.length, 0)
  const first = b.host.read()
  assert.deepEqual(first.queue.sessionIds, ['native']); assert.equal(first.writable, false); assert.equal(first.migration.status, 'initializing')
  wait.resolve(); await b.host.settled(); await b.host.dispose()
})
 test('one migration preserves legacy rank, imports native membership and never writes legacy', async () => {
  const old = legacyQueue(['b', 'already', 'a']), saved = clone(old)
  const b = bench({ pins: ['native', 'already'], legacy: old })
  const result = await ready(b)
  assert.equal(result.migration.status, 'done'); assert.equal(result.writable, true)
  assert.deepEqual(result.queue.sessionIds, ['b', 'already', 'a', 'native'])
  assert.deepEqual(b.calls, [['pin', 'b'], ['pin', 'a']]); assert.deepEqual(old, saved)
  assert.equal(b.writes[0].migration.status, 'running')
  assert.ok(b.writes.some(row => row.migration.entries.some(entry => entry.sessionId === 'b' && entry.status === 'attempted')))
  assert.ok(b.closes.includes('legacy')); await b.host.dispose()
})
 test('native domain payload leads stale registry getters and never reimports after native unpin', async () => {
  const b = bench({ legacy: legacyQueue(['a']) }); await ready(b)
  b.native([], [], () => { assert.deepEqual(b.registry.pinnedSessionIds, ['a']); assert.deepEqual(b.host.current().queue.sessionIds, []) })
  await b.host.settled(); b.host.read(); await b.host.settled()
  assert.deepEqual(b.calls, [['pin', 'a']]); assert.deepEqual(b.host.current().queue.sessionIds, [])
  const persisted = clone(b.records.get('global')); await b.host.dispose()
  const restarted = bench({ existing: persisted, legacy: legacyQueue(['a', 'new-legacy-after-rollback']) })
  await ready(restarted); assert.equal(restarted.legacyOpens, 0); assert.equal(restarted.calls.length, 0)
  assert.deepEqual(restarted.host.current().queue.sessionIds, []); await restarted.host.dispose()
})
 test('initially native-pinned seed is never a later import target after its unpin', async () => {
  const wait = deferred(), b = bench({ pins: ['a'], legacy: legacyQueue(['a']), beforeWrite: async (_, n) => { if (n === 0) await wait.promise } })
  b.host.read(); b.native([]); wait.resolve(); await b.host.settled()
  assert.deepEqual(b.calls, []); assert.deepEqual(b.host.current().queue.sessionIds, []); await b.host.dispose()
})
 test('a native touch during journal durability suppresses an import before enqueue', async () => {
  let b
  b = bench({ legacy: legacyQueue(['a']), beforeWrite: async value => {
    if (value.migration.entries[0]?.status === 'attempted') { b.native(['a']); b.native([]) }
  } })
  await ready(b); assert.deepEqual(b.calls, []); assert.deepEqual(b.host.current().queue.sessionIds, [])
  assert.equal(b.records.get('global').migration.entries[0].status, 'skipped'); await b.host.dispose()
})
 test('explicit compatibility unpin suppresses a pending import even when native unpin is a no-op', async () => {
  const wait = deferred(), b = bench({ legacy: legacyQueue(['a']), beforeWrite: async (_, n) => { if (n === 0) await wait.promise } })
  b.host.read()
  const unpin = b.host.mutate({ action: 'unpin', sessionId: 'a' })
  wait.resolve(); await unpin; await b.host.settled()
  assert.deepEqual(b.calls, [['unpin', 'a']]); assert.deepEqual(b.host.current().queue.sessionIds, []); await b.host.dispose()
})
 test('interrupted journal never retries attempted OR pending legacy ids on restart', async () => {
  const b = bench({ existing: savedOrder(['a', 'b'], 'running', [{ sessionId: 'a', status: 'attempted' }, { sessionId: 'b', status: 'pending' }]), legacy: legacyQueue(['a', 'b']) })
  const result = await ready(b)
  assert.equal(result.migration.status, 'partial'); assert.ok(result.warnings.some(text => /interrupted/.test(text)))
  assert.deepEqual(b.calls, []); assert.equal(b.legacyOpens, 0)
  assert.ok(b.records.get('global').migration.entries.every(entry => entry.status === 'uncertain')); await b.host.dispose()
})
 test('archive removes membership; unarchive and workspace-record events never restore pins', async () => {
  const b = bench({ pins: ['a', 'b'], existing: savedOrder(['b', 'a']) }); await ready(b)
  b.native(['b'], ['a']); await b.host.settled(); assert.deepEqual(b.host.current().queue.sessionIds, ['b'])
  b.native(['b'], []); for (const fn of b.listeners) fn({ domain: 'workspace', table: 'workspaces', key: 'w', operation: 'deleted' })
  await b.host.settled(); assert.deepEqual(b.host.current().queue.sessionIds, ['b']); assert.deepEqual(b.calls, []); await b.host.dispose()
})
 test('blank or uncatalogued native pins stay members; controller does not infer deletion', async () => {
  const b = bench({ pins: ['blank', 'cold-without-cwd'], existing: savedOrder(['blank']) })
  await ready(b); assert.deepEqual(b.host.current().queue.sessionIds, ['blank', 'cold-without-cwd']); assert.deepEqual(b.calls, []); await b.host.dispose()
})
 test('unknown/archive migration candidates do not block other entries and faults are explicit', async () => {
  const b = bench({ archived: ['archived'], legacy: legacyQueue(['missing-id', 'archived', 'bad', 'good']), pinFailure: async id => { if (id === 'bad') throw Error('disk unavailable') } })
  const result = await ready(b)
  assert.equal(result.migration.status, 'partial'); assert.deepEqual(result.queue.sessionIds, ['good'])
  assert.ok(result.warnings.some(text => /disk unavailable/.test(text))); assert.ok(result.warnings.some(text => /unknown/.test(text)))
  assert.equal(b.calls.some(([, id]) => id === 'archived'), false); await b.host.dispose()
})
 test('fence write failure never performs any native pin and read remains available with error', async () => {
  const b = bench({ pins: ['native'], legacy: legacyQueue(['a']), beforeWrite: async () => { throw Error('order disk full') } })
  const result = await ready(b)
  assert.equal(result.migration.status, 'error'); assert.equal(result.writable, false)
  assert.deepEqual(result.queue.sessionIds, ['native']); assert.deepEqual(b.calls, []); assert.ok(result.warnings.length); await b.host.dispose()
})
 test('journal failure after native pin leaves an uncertain fence and never compensates or retries', async () => {
  const b = bench({ legacy: legacyQueue(['a', 'b']), beforeWrite: async value => { if (value.migration.entries.some(entry => entry.status === 'imported')) throw Error('journal offline') } })
  const result = await ready(b)
  assert.equal(result.migration.status, 'error'); assert.deepEqual(result.queue.sessionIds, ['a'])
  assert.deepEqual(b.calls, [['pin', 'a']]); assert.equal(b.records.get('global').migration.entries[0].status, 'attempted')
  b.native([]); const saved = clone(b.records.get('global')); await b.host.dispose()
  const restarted = bench({ existing: saved, legacy: legacyQueue(['a', 'b']) }); await ready(restarted)
  assert.deepEqual(restarted.calls, []); assert.deepEqual(restarted.host.current().queue.sessionIds, []); await restarted.host.dispose()
})
 test('malformed native payload retains the last membership instead of interpreting an empty pin set', async () => {
  const b = bench({ pins: ['a'], existing: savedOrder(['a']) }); await ready(b)
  for (const fn of b.listeners) fn({ domain: 'workspace', table: '', key: '', operation: 'put', value: { pinnedSessionIds: null, archivedSessionIds: [] } })
  assert.deepEqual(b.host.current().queue.sessionIds, ['a']); assert.equal(b.host.current().writable, false)
  assert.ok(b.host.current().warnings.length); assert.deepEqual(b.calls, []); await b.host.dispose()
})
 test('order storage failure is scoped and does not perform eager legacy reads or mutations', async () => {
  const b = bench({ pins: ['native'], openFailure: Error('backend offline') })
  const result = await ready(b)
  assert.deepEqual(result.queue.sessionIds, ['native']); assert.equal(result.migration.status, 'error'); assert.equal(b.legacyOpens, 0)
  assert.deepEqual(b.calls, []); await b.host.dispose()
})
 test('CAS moves preserve all hidden native ids and do not change native pin ordering', async () => {
  const b = bench({ pins: ['a', 'hidden', 'b'], existing: savedOrder(['a', 'hidden', 'b']) }); await ready(b)
  const rev = b.host.current().queue.revision
  const result = await b.host.mutate({ action: 'move', sessionId: 'b', beforeSessionId: 'a', expectedRevision: rev })
  assert.deepEqual(result.queue.sessionIds, ['b', 'a', 'hidden']); assert.deepEqual(b.registry.pinnedSessionIds, ['a', 'hidden', 'b']); assert.deepEqual(b.calls, [])
  await assert.rejects(b.host.mutate({ action: 'move', sessionId: 'hidden', beforeSessionId: null, expectedRevision: rev }), error => error.status === 409)
  await b.host.dispose()
})
 test('concurrent CAS moves admit one revision and reject the competing stale writer', async () => {
  const b = bench({ pins: ['a', 'b', 'c'], existing: savedOrder(['a', 'b', 'c']) }); await ready(b)
  const expectedRevision = b.host.current().queue.revision
  const results = await Promise.allSettled([
    b.host.mutate({ action: 'move', sessionId: 'c', beforeSessionId: 'a', expectedRevision }),
    b.host.mutate({ action: 'move', sessionId: 'b', beforeSessionId: 'c', expectedRevision }),
  ])
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.status, 409); await b.host.dispose()
})
 test('native change during order durability cannot resurrect membership or silently admit a stale move', async () => {
  let armed = false, b
  b = bench({ pins: ['a', 'b'], existing: savedOrder(['a', 'b']), beforeWrite: async () => { if (armed) { armed = false; b.native(['a']) } } })
  await ready(b); armed = true
  await assert.rejects(b.host.mutate({ action: 'move', sessionId: 'b', beforeSessionId: 'a', expectedRevision: b.host.current().queue.revision }), error => error.status === 409)
  assert.deepEqual(b.host.current().queue.sessionIds, ['a']); assert.deepEqual(b.calls, []); await b.host.dispose()
})
 test('native compatibility pin success is not rolled back when order persistence fails', async () => {
  let fail = false
  const b = bench({ existing: savedOrder([]), beforeWrite: async () => { if (fail) throw Error('order write failed') } }); await ready(b); fail = true
  const result = await b.host.mutate({ action: 'pin-created', sessionId: 'blank' })
  assert.deepEqual(result.queue.sessionIds, ['blank']); assert.ok(result.warnings.some(text => /succeeded/.test(text)))
  assert.deepEqual(b.calls, [['pin', 'blank']]); await b.host.dispose()
})
 test('lifecycle stops fresh imports and releases only its own listeners and domains', async () => {
  const wait = deferred(), b = bench({ legacy: legacyQueue(['a', 'b']), pinFailure: async id => { if (id === 'a') await wait.promise } })
  b.host.read(); while (!b.calls.length) await new Promise(resolve => setImmediate(resolve))
  const closing = b.host.dispose(); assert.equal(b.listeners.size, 0); wait.resolve(); await closing
  assert.deepEqual(b.calls, [['pin', 'a']]); assert.ok(b.closes.includes('order')); assert.ok(b.closes.includes('legacy'))
})

async function http(host, method, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]); req.method = method
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(text) { this.body = JSON.parse(text) } }
  await createNativePinHttpHandler(host)(req, res); return res
}
 test('HTTP GET starts migration without waiting; moving while busy is finite 503 with truthful queue', async () => {
  const wait = deferred(), b = bench({ pins: ['a'], beforeWrite: async (_, n) => { if (n === 0) await wait.promise } })
  const get = await http(b.host, 'GET'); assert.equal(get.statusCode, 200); assert.equal(get.body.writable, false); assert.deepEqual(get.body.queue.sessionIds, ['a'])
  const busy = await http(b.host, 'POST', { action: 'move', sessionId: 'a', expectedRevision: get.body.queue.revision })
  assert.equal(busy.statusCode, 503); assert.deepEqual(busy.body.queue.sessionIds, ['a'])
  wait.resolve(); await b.host.settled(); await b.host.dispose()
})
 test('HTTP compatibility pin/unpin delegates registry, unknown and malformed requests remain explicit', async () => {
  const b = bench({ existing: savedOrder([]) }); await ready(b)
  assert.equal((await http(b.host, 'POST', { action: 'pin-created', sessionId: 'blank' })).statusCode, 200)
  assert.deepEqual((await http(b.host, 'POST', { action: 'unpin', sessionId: 'blank' })).body.queue.sessionIds, [])
  assert.equal((await http(b.host, 'POST', { action: 'pin', sessionId: 'missing-id' })).statusCode, 404)
  assert.equal((await http(b.host, 'POST', '{')).statusCode, 400)
  assert.equal((await http(b.host, 'DELETE')).statusCode, 405)
  assert.deepEqual(b.calls, [['pin', 'blank'], ['unpin', 'blank'], ['pin', 'missing-id']]); await b.host.dispose()
})
 test('new domain remains independent and legacy schema stays rollback-readable; Final uses native truth', () => {
  assert.equal(pinQueueDomain.name, 'better_tasks_pin_queue'); assert.equal(pinQueueDomain.version, 1)
  assert.deepEqual(Object.keys(pinQueueDomain.tables), ['queues'])
  assert.equal(nativePinOrderDomain.name, 'better_tasks_native_order'); assert.equal(nativePinOrderDomain.version, 1)
  assert.deepEqual(pinQueueDomain.tables.queues.valueSchema.parse(legacyQueue(['a'])), legacyQueue(['a']))
  assert.doesNotThrow(() => nativePinOrderDomain.tables.state.valueSchema.parse(savedOrder(['a'])))
  const code = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8'), active = code.slice(code.indexOf('export async function apply'))
  assert.match(active, /isPinned: \(sessionId\) => ctx\.workspaceRegistry\.pinnedSessionIds\.includes/)
  assert.doesNotMatch(active, /sessionController\.list|createEmptyPinQueue|applyPinCommand|prunePinQueue/)
})
