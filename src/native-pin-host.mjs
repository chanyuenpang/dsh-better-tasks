// Official Workspace pins own membership. This controller owns one complete order
// and a sealed, at-most-once legacy import journal; it never compensates native Pin.
const NATIVE_ORDER_KEY = 'global'
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index])
const ownedIds = value => {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id === '') || new Set(value).size !== value.length) throw new Error('Invalid native pin/order identities')
  return [...value]
}
const messageOf = error => String(error?.message ?? error).slice(0, 1000)
const changedIds = (a, b) => {
  const before = new Set(a), after = new Set(b)
  return [...a.filter(id => !after.has(id)), ...b.filter(id => !before.has(id))]
}
// New members join the complete sequence immediately. Pure native array reorders
// cannot move existing members; neither clocks nor Session content are involved.
const mergeOrder = (sequence, pins, reserved = new Set()) => {
  const members = new Set(pins), ranked = new Set(sequence)
  return [...pins.filter(id => !ranked.has(id)), ...sequence.filter(id => members.has(id) || reserved.has(id))]
}
export class NativePinError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

/** open* returns {table,close}; subscribe returns an event unsubscriber. */
export function createNativePinHost({ registry, openOrder, openLegacy, subscribe, now = () => new Date().toISOString() }) {
  let pins = [], archived = [], rank = [], sequence = [], revision = 0, updatedAt = now(), epoch = 0
  let phase = 'initializing', record, table, disposed = false, started = false, nativeValid = true, hydrated = false
  let tail = Promise.resolve(), initialization, migration, reconcileQueued = false, persistenceError = null
  const snapshots = [], handles = new Set(), touched = new Set(), reservedIds = new Set(), warnings = [], warningSet = new Set()
  const warn = error => { const text = messageOf(error); if (!warningSet.has(text)) { warningSet.add(text); warnings.push(text); if (warnings.length > 30) warnings.shift() } }
  const enqueue = work => {
    const next = tail.then(() => { if (disposed) throw new NativePinError('better-tasks/closed', 'Task ordering is closed', 503); return work() })
    tail = next.catch(() => {})
    return next
  }
  const orderedIds = () => sequence.filter(id => pins.includes(id))
  const orderReady = () => !disposed && nativeValid && table !== undefined && (phase === 'done' || phase === 'partial')
  const response = () => {
    const errors = [...warnings, ...(persistenceError ? [persistenceError] : [])]
    return {
      queue: { schemaVersion: 1, revision, sessionIds: orderedIds(), updatedAt },
      ...(errors.length ? { warnings: errors } : {}),
      migration: { status: phase },
      writable: orderReady() && !persistenceError && sameIds(rank, orderedIds()),
    }
  }
  const reservations = () => new Set([...reservedIds].filter(id => !touched.has(id) && !archived.includes(id)))
  const nativeSnapshot = (nextPins, nextArchived, observe = true) => {
    const a = ownedIds(nextArchived), excluded = new Set(a), p = ownedIds(nextPins).filter(id => !excluded.has(id))
    nativeValid = true
    if (sameIds(p, pins) && sameIds(a, archived)) return
    const membershipChanged = changedIds(pins, p).length > 0 || changedIds(archived, a).length > 0
    if (observe) for (const id of [...changedIds(pins, p), ...changedIds(archived, a)]) touched.add(id)
    pins = p; archived = a
    if (!observe) { sequence = [...p]; return }
    if (membershipChanged) epoch++
    // Retain all transitions while opening storage, including Unpin -> Pin of
    // the same id. One latest snapshot would lose its re-insertion position.
    if (!hydrated) snapshots.push([...p])
    sequence = mergeOrder(sequence, pins, reservations())
    if (membershipChanged) start()
    scheduleReconcile()
  }
  function scheduleReconcile() {
    if (!orderReady() || reconcileQueued) return
    reconcileQueued = true
    void enqueue(async () => {
      try { await reconcile() } finally { reconcileQueued = false }
    }).catch(() => {})
  }
  // Storage emits before WorkspaceRegistry's private cache is assigned. Always
  // consume the owned event payload, never registry getters inside this callback.
  const off = subscribe(change => {
    if (disposed || change?.domain !== 'workspace' || change.table !== '' || change.key !== '' || change.operation !== 'put') return
    try { nativeSnapshot(change.value?.pinnedSessionIds, change.value?.archivedSessionIds) }
    catch (error) { nativeValid = false; warn(error) }
  })
  try { nativeSnapshot(registry.pinnedSessionIds, registry.archivedSessionIds, false) }
  catch (error) { nativeValid = false; warn(error); phase = 'error' }
  const initialPins = [...pins], initiallyPinned = new Set(pins)

  async function save(next) {
    const nextRank = ownedIds(next.sessionIds)
    // Legacy fields remain readable in the v1 schema, but are no longer writers
    // or authorities. Every new commit contains just one complete order.
    const { manualSessionIds, manualOrderAt, taskCreatedAtBySession, taskFirstWorkAtBySession, ...base } = next
    const value = { ...base, schemaVersion: 1, revision: revision + 1, sessionIds: nextRank, updatedAt: now() }
    try {
      if (record === undefined) await table.put(NATIVE_ORDER_KEY, value)
      else await table.update(NATIVE_ORDER_KEY, () => value)
    } catch (error) {
      persistenceError = 'Task order was not saved; official Pin membership is unchanged: ' + messageOf(error)
      throw error
    }
    // Never advance a committed revision/rank before storage acknowledges. The
    // live sequence may already include newer events received during this write.
    record = value; rank = [...value.sessionIds]; revision = value.revision; updatedAt = value.updatedAt
    persistenceError = null
    return value
  }
  async function reconcile() {
    if (!orderReady() || record === undefined) return
    while (!sameIds(rank, orderedIds())) await save({ ...record, sessionIds: orderedIds() })
    persistenceError = null
  }
  async function open(factory) {
    const handle = await factory()
    if (disposed) { await handle.close(); throw new NativePinError('better-tasks/closed', 'Task ordering is closed', 503) }
    handles.add(handle)
    return handle
  }
  async function close(handle) { if (!handles.delete(handle)) return; await handle.close() }
  const replaceEntry = (id, patch) => ({ ...record, sessionIds: [...sequence], migration: { ...record.migration,
    entries: record.migration.entries.map(entry => entry.sessionId === id ? { ...entry, ...patch } : entry) } })

  async function runMigration() {
    for (const entry of record.migration.entries) {
      if (disposed) return
      if (entry.status !== 'pending') continue
      await enqueue(async () => {
        if (!nativeValid) throw new Error('Native pin state is unavailable; legacy import has stopped')
        if (touched.has(entry.sessionId) || pins.includes(entry.sessionId) || archived.includes(entry.sessionId)) {
          await save(replaceEntry(entry.sessionId, { status: 'skipped', detail: 'Native pin/archive activity takes precedence' })); return
        }
        // Durable BEFORE the side effect. An interrupted journal never retries.
        await save(replaceEntry(entry.sessionId, { status: 'attempted' }))
        if (disposed) return
        if (!nativeValid) throw new Error('Native pin state became unavailable before legacy import')
        if (touched.has(entry.sessionId) || pins.includes(entry.sessionId) || archived.includes(entry.sessionId)) {
          await save(replaceEntry(entry.sessionId, { status: 'skipped', detail: 'Native activity while import was preparing' })); return
        }
        const observedEpoch = epoch
        let outcome
        try {
          await registry.pinSession(entry.sessionId)
          if (observedEpoch === epoch) nativeSnapshot(registry.pinnedSessionIds, registry.archivedSessionIds)
          outcome = { status: 'imported' }
        } catch (error) {
          const known = error?.name === 'WorkspaceUnknownSessionError' || error?.name === 'WorkspaceArchivedSessionPinError'
          outcome = { status: known ? 'skipped' : 'failed', detail: messageOf(error) }
          warn('Legacy task ' + entry.sessionId + ' was not imported: ' + outcome.detail)
        }
        await save(replaceEntry(entry.sessionId, outcome))
      })
    }
    if (disposed) return
    await enqueue(async () => {
      const partial = record.migration.entries.some(entry => entry.status === 'failed' || entry.status === 'attempted')
      const status = partial ? 'partial' : 'done'
      reservedIds.clear()
      sequence = orderedIds() // Remove only the unimported reservations.
      await save({ ...record, sessionIds: [...sequence], migration: { ...record.migration, status } })
      phase = status
      await reconcile()
    })
  }
  function hydrate(base, reserved = new Set()) {
    for (const id of reserved) reservedIds.add(id)
    sequence = mergeOrder(base, initialPins, reserved)
    for (const snapshot of snapshots) sequence = mergeOrder(sequence, snapshot, reserved)
    snapshots.length = 0; hydrated = true
  }
  async function initialize() {
    if (!nativeValid) throw new Error('Native pin state is unavailable')
    const order = await open(openOrder); table = order.table
    const stored = table.get(NATIVE_ORDER_KEY)
    if (stored !== undefined) {
      rank = ownedIds(stored.sessionIds); record = stored; revision = stored.revision; updatedAt = stored.updatedAt
      hydrate(rank)
      for (const entry of stored.migration.entries) if (entry.detail && (entry.status === 'failed' || entry.status === 'uncertain')) warn('Legacy task ' + entry.sessionId + ': ' + entry.detail)
      if (stored.migration.status === 'running') {
        warn('Legacy pin migration was interrupted; unconfirmed entries will not be retried automatically. The original queue is preserved.')
        await enqueue(async () => {
          await save({ ...record, sessionIds: orderedIds(), migration: { ...record.migration, status: 'partial', entries: record.migration.entries.map(entry => entry.status === 'pending' || entry.status === 'attempted' ? { ...entry, status: 'uncertain', detail: 'Interrupted import; use the official Pin control to recover explicitly' } : entry) } })
        })
        phase = 'partial'
      } else phase = stored.migration.status
      await enqueue(reconcile)
      return
    }
    // The legacy unit is opened unchanged, read and closed; never erase its data.
    const legacy = await open(openLegacy)
    let seed
    try { seed = legacy.table.get(NATIVE_ORDER_KEY); if (seed !== undefined) ownedIds(seed.sessionIds) }
    finally { await close(legacy) }
    const seedIds = seed?.sessionIds ?? [], alreadyNative = new Set([...initiallyPinned, ...pins])
    const entries = seedIds.map(sessionId => ({ sessionId,
      status: alreadyNative.has(sessionId) || touched.has(sessionId) || archived.includes(sessionId) ? 'skipped' : 'pending',
      ...(alreadyNative.has(sessionId) ? { detail: 'Already officially pinned; never an import target' } : {}),
    }))
    const pending = new Set(entries.filter(entry => entry.status === 'pending').map(entry => entry.sessionId))
    hydrate([...seedIds, ...initialPins.filter(id => !seedIds.includes(id))], pending)
    // No old import work means no fake migration phase or extra journal writes.
    const status = pending.size ? 'running' : 'done'
    await enqueue(async () => {
      await save({ sessionIds: [...sequence], migration: { status, sourceRevision: seed?.revision ?? null, entries } })
      phase = status
      if (status === 'done') await reconcile()
    })
    if (status === 'running') migration = runMigration().catch(error => { if (!disposed) { warn('Legacy migration stopped: ' + messageOf(error) + '. The original queue is preserved.'); phase = 'error' } })
  }
  function start() {
    if (started || disposed) return
    started = true; phase = 'initializing'
    initialization = initialize().catch(error => {
      // A loaded terminal journal with a dirty sequence can retry a failed save.
      // Opening/fencing/import failures remain terminal and must not replay Pin.
      if (!disposed && !orderReady()) { phase = 'error'; warn('Task order initialization failed: ' + messageOf(error)) }
    })
  }
  function requireCommand(command) {
    if (command === null || typeof command !== 'object' || typeof command.sessionId !== 'string' || command.sessionId === '') throw new NativePinError('better-tasks/invalid-request', 'A Session identity is required')
    if (!['move', 'pin', 'pin-created', 'unpin'].includes(command.action)) throw new NativePinError('better-tasks/invalid-request', 'Unsupported task operation')
  }
  return {
    read() { start(); scheduleReconcile(); return response() },
    current: response,
    async mutate(command) {
      requireCommand(command)
      if (command.action !== 'move') touched.add(command.sessionId)
      start()
      if (command.action === 'move' && !orderReady()) throw new NativePinError('better-tasks/order-unavailable', 'Task order is initializing, importing or unavailable; official Pin remains usable', 503)
      return enqueue(async () => {
        if (command.action !== 'move') {
          const observedEpoch = epoch
          if (command.action === 'unpin') await registry.unpinSession(command.sessionId)
          else await registry.pinSession(command.sessionId)
          if (observedEpoch === epoch) nativeSnapshot(registry.pinnedSessionIds, registry.archivedSessionIds)
          try { await reconcile() } catch { /* save exposes persistenceError; never undo the native result. */ }
          return response()
        }
        if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) throw new NativePinError('better-tasks/invalid-request', 'expectedRevision must be a non-negative safe integer')
        if (!orderReady()) throw new NativePinError('better-tasks/order-unavailable', 'Task ordering is unavailable; official Pin remains usable', 503)
        await reconcile()
        if (command.expectedRevision !== revision) throw new NativePinError('better-tasks/revision-conflict', 'Task order changed', 409)
        const ids = orderedIds(), before = command.beforeSessionId ?? null
        if (!ids.includes(command.sessionId)) throw new NativePinError('better-tasks/not-pinned', 'Session is no longer officially pinned', 409)
        if (before !== null && (typeof before !== 'string' || !ids.includes(before))) throw new NativePinError('better-tasks/anchor-not-pinned', 'Move anchor is no longer officially pinned', 409)
        if (before === command.sessionId) return response()
        const next = ids.filter(id => id !== command.sessionId)
        next.splice(before === null ? next.length : next.indexOf(before), 0, command.sessionId)
        if (sameIds(next, ids)) return response()
        const observedEpoch = epoch
        await save({ ...record, sessionIds: next })
        if (observedEpoch !== epoch) {
          await reconcile()
          throw new NativePinError('better-tasks/revision-conflict', 'Official membership changed while saving task order', 409)
        }
        sequence = next
        return response()
      })
    },
    async settled() { await initialization; await migration; await tail },
    async dispose() {
      if (disposed) return
      disposed = true; off?.()
      await initialization; await migration; await tail
      await Promise.all([...handles].map(close))
    },
  }
}
