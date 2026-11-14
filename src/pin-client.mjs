const EMPTY_QUEUE = Object.freeze({ schemaVersion: 1, revision: 0, sessionIds: Object.freeze([]), updatedAt: '' })

function validQueue(value) {
  return value !== null && typeof value === 'object' && value.schemaVersion === 1 &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.sessionIds) &&
    value.sessionIds.every(id => typeof id === 'string' && id !== '') &&
    new Set(value.sessionIds).size === value.sessionIds.length && typeof value.updatedAt === 'string'
}
function ownedQueue(value) {
  if (!validQueue(value)) throw new Error('better-tasks: Host returned an invalid task order')
  return Object.freeze({ ...value, sessionIds: Object.freeze([...value.sessionIds]) })
}
function createClientSource(initial) {
  let snapshot = initial
  const listeners = new Set()
  return { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { snapshot = next; for (const fn of [...listeners]) fn() } }
}

/** Rank is metadata only: stale rank can never resurrect a native-unpinned Session. */
export function projectNativeTaskQueue(rank, native) {
  const archived = new Set(native?.archivedSessionIds ?? [])
  const pins = [...new Set(native?.pinnedSessionIds ?? [])].filter(id => !archived.has(id))
  const members = new Set(pins), ranked = new Set(rank.sessionIds)
  return Object.freeze({ ...rank, sessionIds: Object.freeze([
    ...pins.filter(id => !ranked.has(id)), ...rank.sessionIds.filter(id => members.has(id)),
  ]) })
}
async function pinRequest(method, body, signal) {
  const response = await fetch('/api/better-tasks/pins', { method, signal,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
  let payload
  try { payload = await response.json() } catch { payload = {} }
  return { response, payload }
}

/** Observe official membership; own only rank refresh, pending feedback and errors. */
export function createTaskPinsClient({ request = pinRequest, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const source = createClientSource(Object.freeze({ phase: 'loading', queue: EMPTY_QUEUE,
    pendingSessionIds: Object.freeze([]), error: null, writable: false, migration: null }))
  const pending = new Map(), pinFlights = new Map()
  // Explicit creation intent only; never infer task birth from dates or history.
  // This affects display order, not official Pin membership or committed rank.
  const created = new Set(), creationFlights = new Map()
  let creationTail = Promise.resolve()
  const lifetime = new AbortController()
  let rank = EMPTY_QUEUE, native, binding, disconnect, tail = Promise.resolve()
  let started = false, disposed = false, generation = 0, loaded = false, writable = false, hasStableRank = false
  let orderError = null, actionError = null, warnings = [], migration = null
  let refreshPromise = null, refreshAgain = false, timer, polls = 0
  const nativeReady = () => native?.phase === 'ready'
  const publish = () => {
    if (disposed) return
    const nativeError = native?.error?.message ?? (native?.state === 'error' ? 'Native Pin service is unavailable' : null)
    const queue = projectNativeTaskQueue(rank, native)
    const front = [...created].reverse().filter(id => queue.sessionIds.includes(id))
    const displayed = front.length === 0 ? queue : Object.freeze({ ...queue,
      sessionIds: Object.freeze([...front, ...queue.sessionIds.filter(id => !created.has(id))]),
    })
    source.set(Object.freeze({ phase: nativeReady() ? 'ready' : 'loading',
      queue: displayed, pendingSessionIds: Object.freeze([...pending.keys()]),
      error: actionError ?? orderError ?? nativeError ?? (warnings.length ? warnings.join('; ') : null),
      writable: nativeReady() && loaded && writable, migration: migration?.status ?? null }))
  }
  const countPending = (id, delta) => {
    const count = (pending.get(id) ?? 0) + delta
    if (count > 0) pending.set(id, count); else pending.delete(id)
    publish()
  }
  const enqueue = work => {
    const next = tail.then(() => { if (disposed) throw new Error('Task pins are disposed'); return work() })
    tail = next.catch(() => {})
    return next
  }
  const stopTimer = () => { if (timer !== undefined) { cancel(timer); timer = undefined } }
  const armMigrationRefresh = () => {
    stopTimer()
    const restoring = ['pending', 'initializing', 'running'].includes(migration?.status)
    const saving = loaded && !writable && ['done', 'partial'].includes(migration?.status)
    if (!started || disposed || !(restoring || saving)) { polls = 0; return }
    if (polls >= 60) return // Native follow/focus still refresh; never poll indefinitely after a stuck migration.
    polls++
    timer = schedule(() => { timer = undefined; void refresh().catch(() => {}) }, 1000)
  }
  const adopt = payload => {
    const incoming = ownedQueue(payload.queue)
    const initializing = payload.migration?.status === 'initializing'
    if (!initializing || !hasStableRank) rank = incoming
    if (!initializing) hasStableRank = true
    loaded = true; writable = payload.writable !== false
    warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(x => typeof x === 'string') : []
    migration = payload.migration ?? null
    orderError = null
    publish(); armMigrationRefresh()
    return source.getSnapshot().queue
  }
  const readOrder = async () => {
    const token = generation
    try {
      const { response, payload } = await request('GET', undefined, lifetime.signal)
      if (disposed || token !== generation) return source.getSnapshot().queue
      if (!response.ok) throw new Error(payload.message ?? `Task order read failed (${response.status})`)
      return adopt(payload)
    } catch (error) {
      if (!disposed && token === generation) { orderError = String(error?.message ?? error); writable = false; publish() }
      throw error
    }
  }
  const refresh = () => {
    if (disposed) return Promise.reject(new Error('Task pins are disposed'))
    if (binding === undefined) return Promise.resolve(source.getSnapshot().queue)
    if (refreshPromise !== null) { refreshAgain = true; return refreshPromise }
    refreshPromise = enqueue(readOrder).finally(() => {
      refreshPromise = null
      if (refreshAgain && !disposed && started && binding !== undefined) { refreshAgain = false; void refresh().catch(() => {}) }
    })
    return refreshPromise
  }
  const connectNative = (next) => {
    disconnect?.()
    if (disposed) return () => {}
    if (next?.source?.getSnapshot === undefined || typeof next?.source?.subscribe !== 'function' ||
      typeof next.pinSession !== 'function' || typeof next.unpinSession !== 'function') {
      orderError = 'Native Pin service is unavailable'; publish(); return () => {}
    }
    binding = next; generation++
    let signature, closed = false
    const observe = () => {
      if (closed || disposed) return
      const snapshot = next.source.getSnapshot()
      native = { ...snapshot, pinnedSessionIds: [...(snapshot.pinnedSessionIds ?? [])], archivedSessionIds: [...(snapshot.archivedSessionIds ?? [])] }
      const value = JSON.stringify([native.pinnedSessionIds, native.archivedSessionIds, native.phase, native.state])
      const changed = signature !== value
      signature = value; publish()
      if (changed && nativeReady() && started) void refresh().catch(() => {})
    }
    const off = next.source.subscribe(observe)
    disconnect = () => {
      if (closed) return
      closed = true; off(); stopTimer(); generation++
      if (binding === next) { binding = undefined; native = undefined; loaded = false; writable = false; publish() }
    }
    observe()
    return disconnect
  }
  const setPinned = (sessionId, pinned) => {
    if (disposed || binding === undefined) return Promise.reject(new Error('Native Pin service is unavailable'))
    const prior = pinFlights.get(sessionId)
    if (prior?.pinned === pinned) return prior.promise
    if (!pending.has(sessionId) && nativeReady() && source.getSnapshot().queue.sessionIds.includes(sessionId) === pinned) {
      return Promise.resolve(source.getSnapshot().queue)
    }
    const target = binding
    actionError = null; countPending(sessionId, 1)
    const promise = Promise.resolve().then(() => (pinned ? target.pinSession : target.unpinSession)(sessionId)).then(() => {
      // Native model/follow owns the result. Never force the requested boolean or
      // retry the Pin just because the separate rank service is unavailable.
      publish(); if (started) void refresh().catch(() => {})
      return source.getSnapshot().queue
    }).catch(error => { actionError = String(error?.message ?? error); publish(); throw error }).finally(() => {
      if (pinFlights.get(sessionId)?.promise === promise) pinFlights.delete(sessionId)
      countPending(sessionId, -1)
    })
    pinFlights.set(sessionId, { pinned, promise })
    return promise
  }
  const moveBefore = (sessionId, beforeSessionId, { front = false } = {}) => {
    actionError = null; countPending(sessionId, 1)
    return enqueue(async () => {
      if (!loaded || !writable) await readOrder()
      if (!writable) throw new Error('Task order is not ready or has not been saved; official Pin remains usable')
      for (let attempt = 0; attempt < 2; attempt++) {
        const queue = projectNativeTaskQueue(rank, native)
        // Creation means absolute first, so rebase its anchor after a CAS conflict.
        // Manual drag keeps its explicit anchor and does not acquire this policy.
        const before = front ? queue.sessionIds.find(id => id !== sessionId) : beforeSessionId
        if (!queue.sessionIds.includes(sessionId) || before != null && !queue.sessionIds.includes(before)) throw new Error('Task is no longer pinned')
        const { response, payload } = await request('POST', {
          action: 'move', sessionId, beforeSessionId: before ?? null, expectedRevision: rank.revision,
        }, lifetime.signal)
        if (disposed) throw new Error('Task pins are disposed')
        if (response.ok) return adopt(payload)
        const hasCurrentOrder = validQueue(payload.queue)
        if (hasCurrentOrder) adopt(payload)
        if (response.status === 409 && hasCurrentOrder) { if (!writable) break; continue }
        throw new Error(payload.message ?? `Task order write failed (${response.status})`)
      }
      throw new Error('Task order changed again; retry the move')
    }).catch(error => { actionError = String(error?.message ?? error); publish(); throw error }).finally(() => countPending(sessionId, -1))
  }
  const pinCreated = sessionId => {
    const prior = creationFlights.get(sessionId)
    if (prior !== undefined) return prior
    created.add(sessionId)
    actionError = null
    // Pin still goes through the native action. The display overlay only applies
    // after official membership confirms the id, including an already-pinned blank.
    const pin = setPinned(sessionId, true)
    countPending(sessionId, 1)
    void pin.catch(() => {}) // A later creation may be waiting behind an earlier one.
    const work = creationTail.then(async () => {
      await pin
      if (disposed) throw new Error('Task pins are disposed')
      if (!hasStableRank) await refresh()
      const ids = projectNativeTaskQueue(rank, native).sessionIds
      if (!ids.includes(sessionId)) throw new Error('Task is no longer pinned')
      if (ids[0] !== sessionId) await moveBefore(sessionId, undefined, { front: true })
      return source.getSnapshot().queue
    }).catch(error => { actionError = String(error?.message ?? error); publish(); throw error }).finally(() => {
      created.delete(sessionId); creationFlights.delete(sessionId)
      countPending(sessionId, -1)
    })
    // Persist in creation-intent order even when native acknowledgements arrive
    // out of order. A later task stays visibly first throughout earlier commits.
    creationTail = work.catch(() => {})
    creationFlights.set(sessionId, work)
    return work
  }
  return {
    source, connectNative, refresh, setPinned, pinCreated, moveBefore,
    start() {
      started = true
      const onFocus = () => { polls = 0; void refresh().catch(() => {}) }
      if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
      if (binding !== undefined && nativeReady()) void refresh().catch(() => {})
      return () => {
        disposed = true; started = false; stopTimer(); disconnect?.(); lifetime.abort()
        if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
      }
    },
  }
}
