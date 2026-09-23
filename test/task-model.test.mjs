import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIDEBAR_CHILD_SLOTS,
  beforeIdForTaskDrop,
  createSidebarChildDeclarations,
  derivePinnedTasks,
  deriveRecentTasks,
  indexWorkspacesBySession,
  loadProjectAppearances,
  summarizeGoal,
  summarizeSession,
  summarizeTodos,
} from '../src/task-model.mjs'

const DAY = 24 * 60 * 60 * 1000

function summary(id, updatedAt, extra = {}) {
  return {
    id,
    displayTitle: `Session ${id}`,
    updatedAt,
    running: false,
    blank: false,
    ...extra,
  }
}

function list(rows, current) {
  return {
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    current,
  }
}

test('declares the six compatibility child seats in native order', () => {
  assert.deepEqual([...SIDEBAR_CHILD_SLOTS], [
    'sidebar.brand.mark',
    'sidebar.brand.name',
    'sidebar.panellist',
    'sidebar.workspaces',
    'sidebar.settings',
    'sidebar.footer.action',
  ])
})

test('filters visibility and activity before applying the top-10 bound', () => {
  const now = 20 * DAY
  const rows = [
    summary('blank', now, { blank: true }),
    summary('subagent', now, { origin: 'subagent' }),
    summary('archived', now),
    summary('old', now - 3 * DAY - 1),
    ...Array.from({ length: 12 }, (_, index) => summary(`s${String(index).padStart(2, '0')}`, now - index)),
  ]
  const tasks = deriveRecentTasks({
    list: list(rows, 's00'),
    archivedSessionIds: ['archived'],
    activityRange: '3d',
    now,
  })
  assert.equal(tasks.length, 10)
  assert.deepEqual(tasks.map((task) => task.id), Array.from({ length: 10 }, (_, index) => `s${String(index).padStart(2, '0')}`))
  assert.equal(tasks[0].current, true)
})

test('includes an activity item exactly on the selected range boundary', () => {
  const now = 30 * DAY
  const tasks = deriveRecentTasks({
    list: list([
      summary('boundary', now - DAY),
      summary('outside', now - DAY - 1),
    ]),
    activityRange: '1d',
    now,
  })
  assert.deepEqual(tasks.map((task) => task.id), ['boundary'])
})

test('uses session id as a deterministic tie-break', () => {
  const rows = [summary('b', 100), summary('a', 100), summary('c', 100)]
  const tasks = deriveRecentTasks({ list: list(rows) })
  assert.deepEqual(tasks.map((task) => task.id), ['a', 'b', 'c'])
})

test('pinned tasks follow Host order and never reorder by updatedAt', () => {
  const rows = [summary('old', 1), summary('new', 999), summary('middle', 50)]
  const tasks = derivePinnedTasks({
    list: list(rows, 'middle'),
    pinnedSessionIds: ['old', 'missing', 'middle', 'new', 'old'],
  })
  assert.deepEqual(tasks.map((task) => task.id), ['old', 'middle', 'new'])
  assert.equal(tasks[1].current, true)
})

test('drop anchors use DOM insert-before semantics', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(beforeIdForTaskDrop(ids, 'b', 'before'), 'b')
  assert.equal(beforeIdForTaskDrop(ids, 'b', 'after'), 'c')
  assert.equal(beforeIdForTaskDrop(ids, 'c', 'after'), null)
  assert.throws(() => beforeIdForTaskDrop(ids, 'missing', 'before'), /unknown drop target/)
})

test('keeps unknown, none and concrete goal states distinct', () => {
  assert.deepEqual(summarizeGoal(undefined), { availability: 'unknown' })
  assert.deepEqual(summarizeGoal(null), { availability: 'none' })
  assert.deepEqual(summarizeGoal({ goal: { phase: 'complete', objective: 'Done' }, roundsStarted: 1 }), { availability: 'none' })
  assert.deepEqual(summarizeGoal({
    goal: {
      phase: 'blocked',
      objective: 'Ship it',
      maxGoalRounds: 8,
      blockedReason: { code: 'approval-required', message: 'Needs approval' },
    },
    roundsStarted: 3,
  }), {
    availability: 'ready',
    phase: 'blocked',
    objective: 'Ship it',
    roundsStarted: 3,
    maxGoalRounds: 8,
    blockedReason: { code: 'approval-required', message: 'Needs approval' },
  })
})

test('summarizes todos without inventing an aggregate lifecycle', () => {
  assert.deepEqual(summarizeTodos(undefined), { availability: 'unknown' })
  assert.deepEqual(summarizeTodos(null), { availability: 'none' })
  assert.deepEqual(summarizeTodos([
    { content: 'one', status: 'pending' },
    { content: 'two', status: 'in_progress' },
    { content: 'three', status: 'completed' },
    { content: 'four', status: 'completed' },
  ]), {
    availability: 'ready',
    pending: 1,
    inProgress: 1,
    completed: 2,
    total: 4,
    items: [
      { content: 'one', status: 'pending' },
      { content: 'two', status: 'in_progress' },
      { content: 'three', status: 'completed' },
      { content: 'four', status: 'completed' },
    ],
  })
})

test('session card precedence is block, running, idle', () => {
  const base = summary('s', 1)
  assert.deepEqual(summarizeSession({ ...base, running: true, completed: true }, { kind: 'question' }), {
    status: 'block',
    interaction: 'question',
  })
  assert.deepEqual(summarizeSession({ ...base, running: true, completed: true }), { status: 'running' })
  assert.deepEqual(summarizeSession({ ...base, completed: true }), { status: 'idle' })
  assert.deepEqual(summarizeSession(base), { status: 'idle' })
})

test('maps sessions to their first owning workspace without duplicating ownership', () => {
  const first = { workspaceId: 'w1', title: 'One', sessionIds: ['s1', 'shared'] }
  const second = { workspaceId: 'w2', title: 'Two', sessionIds: ['s2', 'shared'] }
  const index = indexWorkspacesBySession([first, second])
  assert.equal(index.get('s1'), first)
  assert.equal(index.get('s2'), second)
  assert.equal(index.get('shared'), first)
})

test('appearance loading returns an explicit non-blocking unavailable state', async () => {
  const unavailable = await loadProjectAppearances(async () => { throw new Error('offline') })
  assert.deepEqual(unavailable, {
    status: 'unavailable',
    items: [],
    icons: [],
    colorKeys: [],
    error: 'offline',
  })

  const ready = await loadProjectAppearances(async () => ({
    ok: true,
    async json() { return { items: [{ workspaceId: 'w1', iconKey: 'folder', colorKey: 'blue' }], icons: [{ key: 'folder', nodes: [] }], colorKeys: ['blue'] } },
  }))
  assert.equal(ready.status, 'ready')
  assert.equal(ready.items.length, 1)
  assert.equal(ready.icons.length, 1)
})

test('rejects unsupported activity ranges and invalid bounds', () => {
  assert.throws(() => deriveRecentTasks({ list: list([]), activityRange: '30d' }), /unsupported activity range/)
  assert.throws(() => deriveRecentTasks({ list: list([]), limit: -1 }), /non-negative safe integer/)
})
