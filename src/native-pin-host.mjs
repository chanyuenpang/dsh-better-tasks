// Official Workspace pins own membership. This controller owns rank and a sealed,
// at-most-once legacy import journal only; it never compensates native operations.
const NATIVE_ORDER_KEY = 'global'
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index])
const ownedIds = value => {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id === '') || new Set(value).size !== value.length) throw new Error('Invalid native pin/order identities')
  return [...value]
}
const projectIds = (rank, pins) => {
  const pinned = new Set(pins), ranked = new Set(rank)
  return [...rank.filter(id => pinned.has(id)), ...pins.filter(id => !ranked.has(id))]
}
const messageOf = error => String(error?.message ?? error).slice(0, 1000)
const changedIds = (a, b) => {
  const before = new Set(a), after = new Set(b)
  return [...a.filter(id => !after.has(id)), ...b.filter(id => !before.has(id))]
}
export class NativePinError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

/** open* returns {table,close}; subscribe returns an event unsubscriber. */
export function createNativePinHost({ registry, openOrder, openLegacy, subscribe, now = () => new Date().toISOString() }) {
  let pins = [], archived = [], rank = [], revision = 0, updatedAt = now(), epoch = 0
  let phase = 'initializing', record, table, disposed = false, started = false, nativeValid = true
  let tail = Promise.resolve(), initialization, migration, reconcileQueued = false
  const handles = new Set(), touched = new Set(), warnings = [], warningSet = new Set()
  const warn = error => { const text = messageOf(error); if (!warningSet.has(text)) { warningSet.add(text); warnings.push(text); if (warnings.length > 30) warnings.shift() } }
  const enqueue = work => {
    const next = tail.then(() => { if (disposed) throw new NativePinError('better-tasks/closed', 'Task ordering is closed', 503); return work() })
    tail = next.catch(() => {})
    return next
  }
  const response = () => ({
    queue: { schemaVersion: 1, revision, sessionIds: projectIds(rank, pins), updatedAt },
    ...(warnings.length === 0 ? {} : { warnings: [...warnings] }),
    migration: { status: phase }, writable: !disposed && nativeValid && table !== undefined && (phase === 'done' || phase === 'partial'),
  })
  const nativeSnapshot = (nextPins, nextArchived, observe = true) => {
    const p = ownedIds(nextPins), a = ownedIds(nextArchived)
    nativeValid = true
    if (sameIds(p, pins) && sameIds(a, archived)) return
    if (observe) for (const id of [...changedIds(pins, p), ...changedIds(archived, a)]) touched.add(id)
    const previous = projectIds(rank, pins)
    pins = p; archived = a; epoch++
    if (!sameIds(previous, projectIds(rank, pins))) { revision++; updatedAt = now() }
    scheduleReconcile()
  }
  function scheduleReconcile() {
    if (!disposed && nativeValid && started && table !== undefined && (phase === 'done' || phase === 'partial') && !reconcileQueued) {
      reconcileQueued = true
      void enqueue(async () => { reconcileQueued = false; await reconcile() }).catch(error => { reconcileQueued = false; warn(error) })
    }
  }
  // Storage emits before WorkspaceRegistry's private cache is assigned. Payload
  // ownership is essential: never synchronously read registry getters here.
  const off = subscribe(change => {
    if (disposed || change?.domain !== 'workspace' || change.table !== '' || change.key !== '' || change.operation !== 'put') return
    try { nativeSnapshot(change.value?.pinnedSessionIds, change.value?.archivedSessionIds) }
    catch (error) { nativeValid = false; warn(error) }
  })
  try { nativeSnapshot(registry.pinnedSessionIds, registry.archivedSessionIds, false) }
  catch (error) { nativeValid = false; warn(error); phase = 'error' }
  const initiallyPinned = new Set(pins)

  async function save(next) {
    const nextRank = ownedIds(next.sessionIds)
    const nextRevision = Math.max(revision, record?.revision ?? 0) + (sameIds(rank, nextRank) ? 0 : 1)
    const value = { ...next, schemaVersion: 1, revision: nextRevision, sessionIds: nextRank, updatedAt: now() }
    // A singleton owner plus this controller's tail owns all writes to this domain.
    if (record === undefined) await table.put(NATIVE_ORDER_KEY, value)
    else await table.update(NATIVE_ORDER_KEY, () => value)
    record = value; rank = [...value.sessionIds]; revision = Math.max(revision, value.revision); updatedAt = value.updatedAt
    return value
  }
  async function reconcile() {
    if (record === undefined || phase === 'initializing' || phase === 'running') return
    const ids = projectIds(rank, pins)
    if (sameIds(ids, rank) && record.revision === revision) return
    await save({ ...record, sessionIds: ids })
  }
  async function open(factory) {
    const handle = await factory()
    if (disposed) { await handle.close(); throw new NativePinError('better-tasks/closed', 'Task ordering is closed', 503) }
    handles.add(handle)
    return handle
  }
  async function close(handle) { if (!handles.delete(handle)) return; await handle.close() }
  const replaceEntry = (id, patch) => ({ ...record, migration: { ...record.migration,
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
          warn(`Legacy task ${entry.sessionId} was not imported: ${outcome.detail}`)
        }
        await save(replaceEntry(entry.sessionId, outcome))
      })
    }
    if (disposed) return
    await enqueue(async () => {
      const partial = record.migration.entries.some(entry => entry.status === 'failed' || entry.status === 'attempted')
      const status = partial ? 'partial' : 'done'
      // Until now legacy seed rank was retained even for not-yet-imported ids.
      await save({ ...record, sessionIds: projectIds(rank, pins), migration: { ...record.migration, status } })
      phase = status
    })
  }
  async function initialize() {
    if (!nativeValid) throw new Error('Native pin state is unavailable')
    const order = await open(openOrder); table = order.table
    const stored = table.get(NATIVE_ORDER_KEY)
    if (stored !== undefined) {
      rank = ownedIds(stored.sessionIds); record = stored; revision = Math.max(revision, stored.revision); updatedAt = stored.updatedAt
      for (const entry of stored.migration.entries) if (entry.detail && (entry.status === 'failed' || entry.status === 'uncertain')) warn(`Legacy task ${entry.sessionId}: ${entry.detail}`)
      if (stored.migration.status === 'running') {
        warn('Legacy pin migration was interrupted; unconfirmed entries will not be retried automatically. The original queue is preserved.')
        await enqueue(async () => {
          await save({ ...record, sessionIds: projectIds(rank, pins), migration: { ...record.migration, status: 'partial', entries: record.migration.entries.map(entry => entry.status === 'pending' || entry.status === 'attempted' ? { ...entry, status: 'uncertain', detail: 'Interrupted import; use the official Pin control to recover explicitly' } : entry) } })
        })
        phase = 'partial'
      } else phase = stored.migration.status
      await enqueue(reconcile)
      return
    }
    // The legacy unit is opened with its unchanged v1 schema, read, then closed.
    const legacy = await open(openLegacy)
    let seed
    try { seed = legacy.table.get(NATIVE_ORDER_KEY); if (seed !== undefined) ownedIds(seed.sessionIds) }
    finally { await close(legacy) }
    const seedIds = seed?.sessionIds ?? [], alreadyNative = new Set([...initiallyPinned, ...pins])
    const entries = seedIds.map(sessionId => ({ sessionId,
      status: alreadyNative.has(sessionId) || touched.has(sessionId) || archived.includes(sessionId) ? 'skipped' : 'pending',
      ...(alreadyNative.has(sessionId) ? { detail: 'Already officially pinned; never an import target' } : {}),
    }))
    await enqueue(async () => {
      await save({ schemaVersion: 1, revision, sessionIds: [...seedIds, ...pins.filter(id => !seedIds.includes(id))], updatedAt: now(),
        migration: { status: 'running', sourceRevision: seed?.revision ?? null, entries } })
      phase = 'running'
    })
    migration = runMigration().catch(error => { if (!disposed) { warn(`Legacy migration stopped: ${messageOf(error)}. The original queue is preserved.`); phase = 'error' } })
  }
  const start = () => {
    if (started || disposed) return
    started = true; phase = 'initializing'
    initialization = initialize().catch(error => { if (!disposed) { phase = 'error'; warn(`Task order initialization failed: ${messageOf(error)}`) } })
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
      // Explicit compatibility intent also counts when the native call will be
      // an idempotent no-op and therefore emit no workspace change event.
      if (command.action !== 'move') touched.add(command.sessionId)
      start()
      // Do not queue a move behind an in-flight migration I/O operation merely
      // to return the already-known initializing/readonly state afterwards.
      if (command.action === 'move' && !response().writable) throw new NativePinError('better-tasks/order-unavailable', 'Task ordering is initializing, migrating or unavailable; official Pin remains usable', 503)
      return enqueue(async () => {
        if (command.action !== 'move') {
          // Compatibility for old clients; all new UI uses official public controls.
          const observedEpoch = epoch
          if (command.action === 'unpin') await registry.unpinSession(command.sessionId)
          else await registry.pinSession(command.sessionId)
          if (observedEpoch === epoch) nativeSnapshot(registry.pinnedSessionIds, registry.archivedSessionIds)
          try { await reconcile() } catch (error) { warn(`Native pin change succeeded, but task order could not be saved: ${messageOf(error)}`) }
          return response()
        }
        if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) throw new NativePinError('better-tasks/invalid-request', 'expectedRevision must be a non-negative safe integer')
        if (!response().writable) throw new NativePinError('better-tasks/order-unavailable', 'Task ordering is initializing, migrating or unavailable; official Pin remains usable', 503)
        await reconcile()
        if (command.expectedRevision !== revision) throw new NativePinError('better-tasks/revision-conflict', 'Task order changed', 409)
        const ids = projectIds(rank, pins), before = command.beforeSessionId ?? null
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
