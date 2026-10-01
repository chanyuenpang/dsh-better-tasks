// Keep mutations on DSH's native Session, Conversation and Goal transports.
export async function continueIdleTask({ binding, text, goals, submit, getStatus, signal }) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('Prompt cannot be empty')
  const session = binding?.session
  if (session === undefined) throw new Error('Session is unavailable')
  signal?.throwIfAborted()
  const snapshot = session.getSnapshot()
  if (snapshot.removed || snapshot.openState !== undefined && snapshot.openState !== 'open') throw new Error('Session is unavailable')
  let pending
  let running = snapshot.running
  if (getStatus !== undefined) {
    const statusSource = getStatus(session.sessionId)
    const statuses = typeof statusSource?.getSnapshot === 'function' ? statusSource.getSnapshot() : statusSource
    const status = typeof statuses?.get === 'function' ? statuses.get(session.sessionId) : statuses
    if (status === undefined || status === null || typeof status !== 'object') throw new Error('Session status is unavailable')
    running ||= status?.running === true
    pending = status?.pendingInteraction
  } else {
    // Legacy callers only. Desktop surface callers always supply the live status map.
    pending = snapshot.pendingInteraction
  }
  if (running || pending != null) throw new Error('Session is no longer idle')
  const result = submit === undefined
    ? await session.prompt([{ type: 'text', text }], 'steer', signal)
    : await submit({ session, text, signal })
  const accepted = submit === undefined ? result?.ok === true : result?.kind === 'success'
  if (!accepted) throw new Error(result?.error?.message ?? result?.text ?? 'Prompt submission failed')

  // Admission has succeeded. Goal inspection/resume failures are warnings only;
  // neither cancellation nor a CAS conflict can resend or roll back this prompt.
  try {
    let goal
    if (typeof goals?.get === 'function') {
      const current = await goals.get(session.sessionId)
      if (!current?.ok) throw new Error(current?.error?.message ?? 'Goal lookup failed')
      goal = current.value
    } else {
      // Keep the pre-0.2 direct-call contract; the surface manager supplies get().
      goal = session.projections?.faceOf('goal')?.getSnapshot()?.goal
    }
    if (goal == null || goal.phase === 'complete' || goal.phase === 'active' && goal.activation === 'armed') return { warning: null }
    if (Number.isFinite(goal.maxGoalRounds) && Number.isFinite(goal.roundsStarted) && goal.roundsStarted >= goal.maxGoalRounds) {
      return { warning: 'Goal was not resumed: its automatic continuation round budget is exhausted' }
    }
    if (typeof goals?.resume !== 'function') throw new Error('Goal service is unavailable')
    const resumed = await goals.resume(session.sessionId, { id: goal.id, revision: goal.revision })
    if (!resumed?.ok) throw new Error(resumed?.error?.message ?? 'Goal resume failed')
    return { warning: null }
  } catch (error) {
    return { warning: String(error?.message ?? error) }
  }
}

export async function renameTaskSession({ binding, title, sessions, sessionId, signal }) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('Title cannot be empty')
  const trimmed = title.trim()
  const rename = async (current, requireOpen = false) => {
    signal?.throwIfAborted()
    if (current?.session === undefined) throw new Error('Session is unavailable')
    const snapshot = current.session.getSnapshot()
    if (snapshot.removed || requireOpen && snapshot.openState !== 'open') throw new Error('Session is unavailable')
    const result = await current.session.rename(trimmed)
    if (!result?.ok) throw new Error(result?.error?.message ?? 'Rename failed')
  }
  if (sessions !== undefined) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('Session is unavailable')
    const operation = async (reference) => {
      const current = await reference.ready
      if (sessions.binding(sessionId) !== current) throw new Error('Session generation changed')
      return rename(current, true)
    }
    if (typeof sessions.using === 'function') {
      return sessions.using(sessionId, { source: 'controllerOperation', signal }, operation)
    }
    if (typeof sessions.retain !== 'function') throw new Error('Session retention is unavailable')
    const reference = sessions.retain(sessionId, { source: 'controllerOperation', signal })
    try { return await operation(reference) } finally { reference.release() }
  }
  return rename(binding)
}
