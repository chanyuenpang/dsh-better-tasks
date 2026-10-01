import { continueIdleTask, renameTaskSession } from './task-actions.mjs'

const taskInputAbortReason = (signal) => signal?.reason ?? new Error('Input surface creation aborted')

// A waiting caller can leave promptly without cancelling a predecessor's admitted
// operation. The predecessor/factory keeps its own completion cleanup attached.
function taskInputWaitWithSignal(promise, signal) {
  if (signal?.aborted) return Promise.reject(taskInputAbortReason(signal))
  if (signal === undefined) return promise
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(taskInputAbortReason(signal)) }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

/** One task-owned native surface per Session, never the main composer's binding. */
export function createTaskInputManager({ getConversation, getSessions, getStatus, getGoals, isPinned }) {
  const entries = new Map()
  const drafts = new Map()
  const lifetime = new AbortController()
  let disposed = false
  const pinned = id => isPinned === undefined || isPinned(id)
  const freshGoals = {
    get: id => {
      const goals = getGoals?.()
      if (typeof goals?.get !== 'function') throw new Error('Goal service is unavailable')
      return goals.get(id)
    },
    resume: (id, ref) => {
      const goals = getGoals?.()
      if (typeof goals?.resume !== 'function') throw new Error('Goal service is unavailable')
      return goals.resume(id, ref)
    },
  }

  function close(entry) {
    if (entry.closing) return
    entry.closing = true
    // This signal closes UI/creation. The native surface retains any admitted
    // operation; its attempt signal is deliberately not replaced by this one.
    entry.controller.abort(new Error('Task input surface closed'))
    entry.handle?.dispose()
  }

  async function create(sessionId, { signal, onWarning } = {}) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('Session is unavailable')
    const waitingSignal = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
    waitingSignal.throwIfAborted()
    if (disposed) throw new Error('Task input manager is disposed')
    while (entries.has(sessionId)) {
      const previous = entries.get(sessionId)
      if (!previous.closing) throw new Error('Task input surface is already active')
      await taskInputWaitWithSignal(previous.finished, waitingSignal)
      waitingSignal.throwIfAborted()
    }
    if (!pinned(sessionId)) { drafts.delete(sessionId); throw new Error('Task is no longer pinned') }
    const conversation = getConversation?.()
    if (typeof conversation?.input?.createSurface !== 'function') throw new Error('Native task input surface is unavailable')
    const controller = new AbortController()
    let resolveFinished
    const entry = { controller, closing: false, handle: undefined, stop: undefined, done: false,
      finished: new Promise(resolve => { resolveFinished = resolve }) }
    entries.set(sessionId, entry)
    const onAbort = () => close(entry)
    waitingSignal.addEventListener('abort', onAbort, { once: true })
    const save = () => {
      if (entries.get(sessionId) !== entry) return
      if (disposed || !pinned(sessionId)) { drafts.delete(sessionId); return }
      const text = entry.handle?.state.getSnapshot().draft
      if (typeof text === 'string') drafts.set(sessionId, text)
    }
    const finish = () => {
      if (entry.done) return
      entry.done = true
      // Preserve late native failure-restoration before removing the subscriber.
      try { save() } finally {
        try { entry.stop?.() } finally {
          waitingSignal.removeEventListener('abort', onAbort)
          if (entries.get(sessionId) === entry) entries.delete(sessionId)
          resolveFinished()
        }
      }
    }
    const creation = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return conversation.input.createSurface({
        sessionId, signal: controller.signal,
        ...(drafts.has(sessionId) ? { initialDraft: drafts.get(sessionId) } : {}),
        defaultSink: async ({ binding, text, signal: attemptSignal }) => {
          const sessions = getSessions?.()
          if (binding?.session?.sessionId !== sessionId || sessions?.binding(sessionId) !== binding) {
            throw new Error('Session generation changed')
          }
          const sender = getConversation?.()
          if (typeof sender?.sendSession !== 'function') throw new Error('Native Session sender is unavailable')
          const { warning } = await continueIdleTask({
            binding, text, goals: freshGoals, getStatus, signal: attemptSignal,
            submit: ({ session, text: message, signal: sendSignal }) => sender.sendSession(session, message, [], 'steer', sendSignal),
          })
          if (warning !== null) {
            // The prompt is already accepted, including when the task UI closed
            // during flight. Keep the existing global warning channel alive.
            try { entry.handle?.input.notify('info', warning) } catch { /* warning delivery cannot fail admission */ }
            try { onWarning?.(warning) } catch { /* caller notification cannot fail admission */ }
          }
          return { kind: 'success' }
        },
      })
    }).then(handle => {
      entry.handle = handle
      try {
        entry.stop = handle.state.subscribe(save)
        save()
      } catch (error) {
        close(entry)
        Promise.resolve(handle.closed).then(finish, finish).catch(() => {})
        throw error
      }
      Promise.resolve(handle.closed).then(finish, finish).catch(() => {})
      if (entry.closing || waitingSignal.aborted || disposed) {
        handle.dispose()
        throw taskInputAbortReason(waitingSignal.aborted ? waitingSignal : controller.signal)
      }
      return { ...handle, dispose: () => close(entry) }
    }, error => {
      finish()
      throw error
    })
    // Race only the caller's creation wait. A late factory success is still
    // disposed above and its final restored draft collected after closed.
    return taskInputWaitWithSignal(creation, waitingSignal)
  }

  return {
    create,
    rename(sessionId, title) {
      if (disposed) return Promise.reject(new Error('Task input manager is disposed'))
      const sessions = getSessions?.()
      if (sessions === undefined) return Promise.reject(new Error('Session retention is unavailable'))
      return renameTaskSession({ sessions, sessionId, title })
    },
    dispose() {
      if (disposed) return
      disposed = true
      lifetime.abort(new Error('Task input manager is disposed'))
      for (const entry of entries.values()) close(entry)
      drafts.clear()
    },
  }
}
