// Derived exclusively from durable turn events; never owns or mutates execution.
export const TASK_EXECUTION_KEY = 'betterTasksExecution'

export function foldTaskExecution(state, event) {
  if (event.type === 'turn/start') {
    return { turn: event.data.turn, phase: 'running', outcome: null, detail: '' }
  }
  if (event.type !== 'turn/end') return state
  // Ignore a delayed closer for an older turn, including repaired/fork history.
  if (state !== null && event.data.turn < state.turn) return state
  const reason = event.data.reason
  const detail = reason?.kind === 'error' ? reason.error?.message
    : reason?.kind === 'aborted' && reason.reason?.kind === 'hook' ? reason.reason.reason : ''
  return {
    turn: event.data.turn,
    phase: 'ended',
    outcome: reason?.kind ?? 'unknown',
    detail: typeof detail === 'string' ? Array.from(detail).slice(0, 800).join('') : '',
  }
}

export function createTaskExecutionProjection(z) {
  const schema = z.object({
    turn: z.number().int().nonnegative(),
    phase: z.enum(['running', 'ended']),
    outcome: z.string().nullable(),
    detail: z.string(),
  }).nullable()
  return {
    key: TASK_EXECUTION_KEY,
    stateVersion: 1,
    stateSchema: schema,
    init: () => null,
    apply: foldTaskExecution,
    wire: { viewSchema: schema, view: (state) => state },
  }
}
