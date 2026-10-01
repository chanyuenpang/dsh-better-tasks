import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { derivePinnedTasks } from '../src/task-model.mjs'
import { expandFinalForIdleCycles, isProjectionExpanded, createCardFinalExpansionController } from '../src/client.js'

const row = (id, retainedBy, extra = {}) => ({ id, retainedBy, blank: false, running: false, updatedAt: 10, projectionValues: { goal: null, todos: null }, ...extra })
const tasksOf = (rows, panelActive = false) => derivePinnedTasks({
  list: { ids: rows.map(x => x.id), byId: Object.fromEntries(rows.map(x => [x.id, x])) },
  pinnedSessionIds: rows.map(x => x.id), panelActive,
})
const idleRows = tasks => tasks.filter(x => x.session.status === 'idle').map(({ id, updatedAt, current }) => ({ id, updatedAt, current }))

test('native main-view selection, not running/background retention, determines automatic Final suppression', () => {
  const rows = [row('open', { mainView: 1 }), row('side', { sidebar: 1 }), row('background', { agent: 1 }), row('worker', {}, { running: true })]
  const result = expandFinalForIdleCycles({}, idleRows(tasksOf(rows)), {})
  assert.equal(isProjectionExpanded(result.expanded, 'open:final', true), false)
  assert.equal(isProjectionExpanded(result.expanded, 'side:final', true), true)
  assert.equal(isProjectionExpanded(result.expanded, 'background:final', true), true)
  assert.equal(result.cycles.worker, undefined)
  const panel = expandFinalForIdleCycles({}, idleRows(tasksOf(rows, true)), {})
  assert.equal(isProjectionExpanded(panel.expanded, 'open:final', true), true)
})

test('effective disclosure suppresses a current Final before persistence effects and excludes its lazy read', () => {
  const tasks = tasksOf([row('open', { mainView: 1 }), row('other', {})])
  const stored = {}, cycles = {}
  const expanded = expandFinalForIdleCycles(cycles, idleRows(tasks), stored).expanded
  const requests = tasks.filter(task => task.session.status === 'idle' && isProjectionExpanded(expanded, `${task.id}:final`, true))
  assert.deepEqual(requests.map(task => task.id), ['other'])
  assert.deepEqual(stored, {}) // Pure resolution, not a render-time write.
  assert.deepEqual(cycles, {})
})

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const start = source.indexOf('  const toggleProjection = ')
const end = source.indexOf('  const commitDrop = ', start)
const toggleSource = source.slice(start, end)

test('actual manual Final toggle uses effective suppression instead of stale default-true storage', () => {
  let expanded = {}
  const canceled = []
  const context = {
    cardFinalRequests: { current: { cancel: id => canceled.push(id) } },
    finalAutoCycles: {}, idleTasks: [{ id: 'open', updatedAt: 10, current: true }],
    expandFinalForIdleCycles, isProjectionExpanded,
    setExpanded: update => { expanded = update(expanded) },
  }
  const toggle = vm.runInNewContext(`${toggleSource}\ntoggleProjection`, context)
  toggle('open', 'final', true)
  assert.equal(expanded['open:final'], true)
  toggle('open', 'final', true)
  assert.equal(expanded['open:final'], false)
  assert.deepEqual(canceled, ['open', 'open'])
})

test('manual double-click remains authoritative on a newly suppressed current cycle, including before persistence', async () => {
  const idleTasks = [{ id: 'open', updatedAt: 10, current: true }]
  let storedExpanded = {}
  const cycles = {}
  const effective = () => expandFinalForIdleCycles(cycles, idleTasks, storedExpanded).expanded
  const op = createCardFinalExpansionController({
    getTask: () => ({ id: 'open', updatedAt: 10, current: true, session: { status: 'idle' } }),
    getCached: () => ({ status: 'ready', updatedAt: 10, value: { sessionId: 'open', final: { text: 'done' } } }),
    isExpanded: id => isProjectionExpanded(effective(), `${id}:final`, true),
    readFinal: () => { throw new Error('cache must avoid another read') }, onReady: () => {},
    expand: id => { storedExpanded = { ...storedExpanded, [`${id}:final`]: true } },
    collapse: id => { storedExpanded = { ...storedExpanded, [`${id}:final`]: false } },
  })
  assert.equal(isProjectionExpanded(effective(), 'open:final', true), false)
  assert.equal(await op.request('open'), true)
  assert.equal(isProjectionExpanded(effective(), 'open:final', true), true)
  const commit = expandFinalForIdleCycles(cycles, idleTasks, storedExpanded)
  assert.equal(commit.expanded['open:final'], true)
  assert.equal(commit.cycles.open, 10)
  assert.equal(await op.request('open'), true)
  assert.equal(isProjectionExpanded(effective(), 'open:final', true), false)
  const closed = expandFinalForIdleCycles(commit.cycles, idleTasks, storedExpanded)
  assert.equal(closed.expanded['open:final'], false)
  const restart = expandFinalForIdleCycles(closed.cycles, [{ ...idleTasks[0], updatedAt: 1, current: false }], JSON.parse(JSON.stringify(closed.expanded)))
  assert.equal(restart.expanded['open:final'], false)
  op.dispose()
})

test('one synchronous effective map feeds Final display, reading, shortcut and toggles', () => {
  const swimlane = source.slice(source.indexOf('function TaskSwimlane('), source.indexOf('function SidebarRegion('))
  assert.match(swimlane, /current: task\.current/)
  assert.match(swimlane, /const expanded = expandFinalForIdleCycles\(finalAutoCycles, idleTasks, storedExpanded\)\.expanded/)
  assert.ok(swimlane.indexOf('const expanded =') < swimlane.indexOf('const finalRequests ='))
  assert.match(swimlane, /finalShortcutState\.current = \{[^\n]*expanded/)
  assert.match(swimlane, /task\.session\.status === 'idle' && isProjectionExpanded\(expanded, `\$\{task\.id\}:final`, preferences\.defaultFinalExpanded\)/)
  assert.match(toggleSource, /expandFinalForIdleCycles\(finalAutoCycles, idleTasks, current\)\.expanded/)
  assert.match(source, /当前正在浏览的任务进入新空闲周期时不自动展开 Final/)
  assert.match(source, /currently browsed task does not automatically open Final/)
})
