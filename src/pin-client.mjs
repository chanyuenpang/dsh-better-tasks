const EMPTY_QUEUE = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  sessionIds: Object.freeze([]),
  updatedAt: '',
})

function validQueue(value) {
  return value !== null && typeof value === 'object' && value.schemaVersion === 1 &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.sessionIds) &&
    value.sessionIds.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(value.sessionIds).size === value.sessionIds.length && typeof value.updatedAt === 'string'
}

function ownedQueue(value) {
  if (!validQueue(value)) throw new Error('better-tasks: Host returned an invalid pin queue')
  return Object.freeze({
    schemaVersion: 1,
    revision: value.revision,
    sessionIds: Object.freeze([...value.sessionIds]),
    updatedAt: value.updatedAt,
  })
}

function createClientSource(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

async function pinRequest(method, body) {
  const response = await fetch('/api/better-tasks/pins', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }
  return { response, payload }
}

export function createTaskPinsClient() {
  const source = createClientSource(Object.freeze({
    phase: 'loading',
    queue: EMPTY_QUEUE,
    pendingSessionIds: Object.freeze([]),
    error: null,
  }))
  const pending = new Set()
  const optimisticPins = new Map()
  let confirmedQueue = EMPTY_QUEUE
  let tail = Promise.resolve()
  let disposed = false

  const projectedQueue = () => {
    if (optimisticPins.size === 0) return confirmedQueue
    let sessionIds = [...confirmedQueue.sessionIds]
    for (const [sessionId, pinned] of optimisticPins) {
      const index = sessionIds.indexOf(sessionId)
      if (pinned && index === -1) sessionIds.push(sessionId)
      if (!pinned && index !== -1) sessionIds.splice(index, 1)
    }
    return Object.freeze({
      ...confirmedQueue,
      sessionIds: Object.freeze(sessionIds),
    })
  }
  const publish = (patch = {}) => {
    if (disposed) return
    const previous = source.getSnapshot()
    source.set(Object.freeze({
      ...previous,
      ...patch,
      queue: projectedQueue(),
      pendingSessionIds: Object.freeze([...pending]),
    }))
  }
  const adopt = (queue) => {
    confirmedQueue = ownedQueue(queue)
    publish({ phase: 'ready', error: null })
    return confirmedQueue
  }
  const enqueue = (work) => {
    const next = tail.then(work, work)
    tail = next.catch(() => {})
    return next
  }

  const refresh = () => enqueue(async () => {
    const { response, payload } = await pinRequest('GET')
    if (!response.ok) throw new Error(payload.message ?? `pin queue read failed (${response.status})`)
    return adopt(payload.queue)
  }).catch((error) => {
    publish({ phase: source.getSnapshot().phase === 'loading' ? 'error' : source.getSnapshot().phase, error: String(error?.message ?? error) })
    throw error
  })

  const mutate = (sessionId, commandFor, optimisticPinned) => {
    const visibleQueue = source.getSnapshot().queue
    if (optimisticPinned !== undefined && visibleQueue.sessionIds.includes(sessionId) === optimisticPinned) {
      return Promise.resolve(visibleQueue)
    }
    pending.add(sessionId)
    if (optimisticPinned !== undefined) optimisticPins.set(sessionId, optimisticPinned)
    publish({ error: null })
    return enqueue(async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const command = commandFor(confirmedQueue)
          if (command === null) return confirmedQueue
          const { response, payload } = await pinRequest('POST', command)
          if (response.ok) return adopt(payload.queue)
          if (response.status === 409 && validQueue(payload.queue)) {
            adopt(payload.queue)
            continue
          }
          throw new Error(payload.message ?? `pin queue write failed (${response.status})`)
        }
        throw new Error('pin queue changed again; retry the action')
      } finally {
        pending.delete(sessionId)
        optimisticPins.delete(sessionId)
        publish({})
      }
    }).catch((error) => {
      publish({ error: String(error?.message ?? error) })
      throw error
    })
  }

  return {
    source,
    refresh,
    setPinned(sessionId, pinned) {
      return mutate(sessionId, (queue) => {
        const alreadyPinned = queue.sessionIds.includes(sessionId)
        if (alreadyPinned === pinned) return null
        return {
          action: pinned ? 'pin' : 'unpin',
          sessionId,
          expectedRevision: queue.revision,
        }
      }, pinned)
    },
    pinCreated(sessionId) {
      return mutate(sessionId, (queue) => queue.sessionIds.includes(sessionId) ? null : {
        action: 'pin-created',
        sessionId,
        expectedRevision: queue.revision,
      }, true)
    },
    moveBefore(sessionId, beforeSessionId) {
      return mutate(sessionId, (queue) => ({
        action: 'move',
        sessionId,
        beforeSessionId: beforeSessionId ?? null,
        expectedRevision: queue.revision,
      }))
    },
    start() {
      if (typeof window === 'undefined') return () => { disposed = true }
      const onFocus = () => { refresh().catch(() => {}) }
      window.addEventListener('focus', onFocus)
      refresh().catch(() => {})
      return () => {
        disposed = true
        window.removeEventListener('focus', onFocus)
      }
    },
  }
}
