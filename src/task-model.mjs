export const SIDEBAR_CHILD_SLOTS = Object.freeze([
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'sidebar.panellist',
  'sidebar.workspaces',
  'sidebar.settings',
  'sidebar.footer.action',
])

export function createSidebarChildDeclarations() {
  return Object.fromEntries(SIDEBAR_CHILD_SLOTS.map((name) => [name, {
    kind: name === 'sidebar.panellist' || name === 'sidebar.footer.action' ? 'list' : 'single',
    scope: 'root',
  }]))
}

export const ACTIVITY_RANGE_DAYS = Object.freeze({
  all: null,
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '14d': 14,
})

const DAY_MS = 24 * 60 * 60 * 1000

function compareStableRecency(left, right) {
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
  const leftId = String(left.id)
  const rightId = String(right.id)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

export function beforeIdForTaskDrop(orderedIds, overId, half) {
  if (half !== 'before' && half !== 'after') throw new Error(`unsupported drop half: ${half}`)
  const index = orderedIds.indexOf(overId)
  if (index === -1) throw new Error(`unknown drop target: ${overId}`)
  return half === 'before' ? overId : orderedIds[index + 1] ?? null
}

export function indexWorkspacesBySession(workspaces) {
  const index = new Map()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!index.has(sessionId)) index.set(sessionId, workspace)
    }
  }
  return index
}

export async function loadProjectAppearances(fetchImpl, url = '/api/project-appearance') {
  try {
    const response = await fetchImpl(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`appearance request failed: ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload.items) || !Array.isArray(payload.icons)) {
      throw new Error('appearance response is missing items or icons')
    }
    return Object.freeze({
      status: 'ready',
      items: payload.items,
      icons: payload.icons,
      colorKeys: Array.isArray(payload.colorKeys) ? payload.colorKeys : [],
    })
  } catch (error) {
    return Object.freeze({
      status: 'unavailable',
      items: [],
      icons: [],
      colorKeys: [],
      error: String(error?.message ?? error),
    })
  }
}

export function summarizeGoal(value) {
  if (value === undefined) return Object.freeze({ availability: 'unknown' })
  if (value === null || value.goal.phase === 'complete') return Object.freeze({ availability: 'none' })
  const reason = value.goal.blockedReason
  return Object.freeze({
    availability: 'ready',
    id: value.goal.id,
    phase: value.goal.phase,
    objective: value.goal.objective,
    roundsStarted: value.roundsStarted,
    maxGoalRounds: value.goal.maxGoalRounds,
    blockedReason: reason === undefined ? undefined : Object.freeze({ code: reason.code, message: reason.message }),
  })
}

export function summarizeTodos(value) {
  if (value === undefined) return Object.freeze({ availability: 'unknown' })
  if (value === null) return Object.freeze({ availability: 'none' })
  const counts = { pending: 0, inProgress: 0, completed: 0, total: value.length }
  const items = value.map((todo) => {
    if (todo.status === 'pending') counts.pending += 1
    else if (todo.status === 'in_progress') counts.inProgress += 1
    else if (todo.status === 'completed') counts.completed += 1
    return Object.freeze({ content: todo.content, status: todo.status })
  })
  return Object.freeze({ availability: 'ready', ...counts, items: Object.freeze(items) })
}

export function summarizeSession(summary, pendingInteraction) {
  if (pendingInteraction !== undefined) {
    return Object.freeze({ status: 'block', interaction: pendingInteraction.kind })
  }
  if (summary.running) return Object.freeze({ status: 'running' })
  return Object.freeze({ status: 'idle' })
}

function projectTask(summary, currentId, pendingInteraction) {
  const projections = summary.projectionValues
  return Object.freeze({
    id: summary.id,
    title: summary.displayTitle ?? summary.title ?? String(summary.id),
    cwd: summary.cwd,
    updatedAt: summary.updatedAt,
    current: summary.id === currentId,
    goal: summarizeGoal(projections?.goal),
    todos: summarizeTodos(projections?.todos),
    session: summarizeSession(summary, pendingInteraction),
  })
}

/** Derive task cards in the exact Host-owned pin order. */
export function derivePinnedTasks({ list, pinnedSessionIds, pendingInteractions = new Map() }) {
  if (!Array.isArray(pinnedSessionIds)) throw new Error('pinnedSessionIds must be an array')
  const seen = new Set()
  const tasks = []
  for (const id of pinnedSessionIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const summary = list.byId[id]
    if (summary === undefined || summary.blank || summary.origin === 'subagent') continue
    tasks.push(projectTask(summary, list.current, pendingInteractions.get(id)))
  }
  return tasks
}

/**
 * Legacy bounded recent projection retained for compatibility tests and rollback.
 * The task UI no longer uses it as membership or ordering authority.
 */
export function deriveRecentTasks({
  list,
  archivedSessionIds = [],
  pendingInteractions = new Map(),
  activityRange = 'all',
  now = Date.now(),
  limit = 10,
}) {
  if (!Object.hasOwn(ACTIVITY_RANGE_DAYS, activityRange)) {
    throw new Error(`unsupported activity range: ${activityRange}`)
  }
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('limit must be a non-negative safe integer')

  const archived = new Set(archivedSessionIds)
  const days = ACTIVITY_RANGE_DAYS[activityRange]
  const cutoff = days === null ? Number.NEGATIVE_INFINITY : now - days * DAY_MS
  const visible = []

  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    if (summary.blank || summary.origin === 'subagent' || archived.has(summary.id)) continue
    if (summary.updatedAt < cutoff) continue
    visible.push(summary)
  }

  visible.sort(compareStableRecency)
  return visible.slice(0, limit).map((summary) => projectTask(summary, list.current, pendingInteractions.get(summary.id)))
}
