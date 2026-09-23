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
  let tail = Promise.resolve()
  let disposed = false

  const publish = (patch) => {
    if (disposed) return
    const previous = source.getSnapshot()
    source.set(Object.freeze({
      ...previous,
      ...patch,
      pendingSessionIds: Object.freeze([...pending]),
    }))
  }
  const adopt = (queue) => {
    const next = ownedQueue(queue)
    publish({ phase: 'ready', queue: next, error: null })
    return next
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

  const mutate = (sessionId, commandFor) => enqueue(async () => {
    pending.add(sessionId)
    publish({})
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const queue = source.getSnapshot().queue
        const command = commandFor(queue)
        if (command === null) return queue
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
      publish({})
    }
  }).catch((error) => {
    publish({ error: String(error?.message ?? error) })
    throw error
  })

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
      })
    },
    pinCreated(sessionId) {
      return mutate(sessionId, (queue) => queue.sessionIds.includes(sessionId) ? null : {
        action: 'pin-created',
        sessionId,
        expectedRevision: queue.revision,
      })
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
