import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { derivePinnedTasks, runningSessionTreeIds, taskExecutionWarning } from '../src/task-model.mjs'

const row = (id, running = false, extra = {}) => ({ id, running, blank: false, updatedAt: 1, ...extra })
const list = (rows, catalogs = {}) => ({
  ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])),
  projectionsBySession: Object.fromEntries(Object.entries(catalogs).map(([id, children]) => [id, { values: { subagentCatalog: children.map(id => ({ id })) } }])),
})
const tasks = (snapshot, sessionStatuses = new Map(), pendingInteractions = new Map()) => derivePinnedTasks({
  list: snapshot, sessionStatuses, pendingInteractions, pinnedSessionIds: snapshot.ids,
})

test('idle lead stays running until the last child stops, without rendering children as tasks', () => {
  const snapshot = list([row('lead'), row('child', true, { origin: 'subagent' }), row('other')], { lead: ['child'] })
  assert.deepEqual(tasks(snapshot).map(task => [task.id, task.session.status]), [['lead', 'running'], ['other', 'idle']])
  const statuses = new Map([['child', { running: false }]])
  assert.equal(tasks(snapshot, statuses)[0].session.status, 'idle', 'explicit stop wins over stale row')
  statuses.set('child', { running: true })
  assert.equal(tasks(snapshot, statuses)[0].session.status, 'running', 'same child may be reactivated')
})

test('status-only children, multiple siblings and grandchildren count through idle parents', () => {
  const snapshot = list([row('lead'), row('unrelated')], { lead: ['child', 'sibling'], child: ['grandchild'] })
  const statuses = new Map([['grandchild', { running: true }], ['sibling', { running: true }]])
  assert.deepEqual([...runningSessionTreeIds(snapshot, statuses)].sort(), ['child', 'grandchild', 'lead', 'sibling'])
  statuses.set('grandchild', { running: false })
  assert.equal(tasks(snapshot, statuses)[0].session.status, 'running')
  statuses.set('sibling', { running: false })
  assert.equal(tasks(snapshot, statuses)[0].session.status, 'idle')
})

test('native status wins for the lead too; unknown status falls back to list baseline', () => {
  const snapshot = list([row('lead', true)])
  assert.equal(tasks(snapshot, new Map([['lead', { running: false }]]))[0].session.status, 'idle')
  assert.equal(tasks(snapshot, new Map([['lead', { running: undefined }]]))[0].session.status, 'running')
  assert.equal(tasks(list([row('lead')]), new Map([['lead', { running: true }]]))[0].session.status, 'running')
})

test('fork ancestry, old turn projections and mere catalog membership do not imply work', () => {
  const snapshot = list([row('lead', false, { projectionValues: { betterTasksExecution: { phase: 'running' } } }), row('fork', true, { parentSession: 'lead' })], { lead: ['finished-child'] })
  assert.equal(tasks(snapshot)[0].session.status, 'idle')
  assert.equal(tasks(snapshot)[1].session.status, 'running')
})

test('summary catalog fallback remains supported, authoritative empty catalog clears stale edges', () => {
  const lead = row('lead', false, { projectionValues: { subagentCatalog: [{ id: 'child' }] } })
  const statuses = new Map([['child', { running: true }]])
  assert.equal(tasks(list([lead]), statuses)[0].session.status, 'running')
  assert.equal(tasks(list([lead], { lead: [] }), statuses)[0].session.status, 'idle')
})

test('cycles and duplicate edges terminate; immutable native snapshots are not rewritten', () => {
  const snapshot = list([row('lead'), row('child', true, { origin: 'subagent' })], { lead: ['child', 'child'], child: ['lead'] })
  const before = JSON.stringify(snapshot)
  assert.equal(tasks(snapshot)[0].session.status, 'running')
  assert.equal(JSON.stringify(snapshot), before)
})

test('parent pending interaction keeps precedence; child work suppresses false interruption warnings', () => {
  const snapshot = list([row('lead', false, { projectionValues: { betterTasksExecution: { phase: 'running' } } })], { lead: ['child'] })
  const statuses = new Map([['child', { running: true }]])
  const task = tasks(snapshot, statuses)[0]
  assert.equal(taskExecutionWarning({ ...snapshot.byId.lead, running: task.session.status === 'running' }, undefined, 'connected'), null)
  assert.equal(tasks(snapshot, statuses, new Map([['lead', { kind: 'question' }]]))[0].session.status, 'block')
})

test('card rendering and idle-only disclosures share the aggregate instead of re-reading the lead', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, /derivePinnedTasks\(\{[^}]*sessionStatuses,/)
  assert.match(source, /taskExecutionWarning\(\{[^}]*running: task\.session\.status === 'running'/)
  assert.match(source, /const idleTasks = tasks\.filter\(\(task\) => task\.session\.status === 'idle'\)/)
  assert.match(source, /'data-state': task\.session\.status/)
})

test('only selected session titles use the official theme accent in either emphasis mode and on hover', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const rule = '.dbt-task-card[data-current="true"] .dbt-task-rename{color:var(--dsw-alias-brand-primary)}'
  assert.ok(source.includes(rule))
  assert.ok(source.indexOf(rule) > source.indexOf('.dbt-task-rename:hover{'))
  assert.ok(source.includes('.dbt-task-list[data-title-emphasis="task"] ' + rule))
  assert.doesNotMatch(source, /^\.dbt-task-rename\{[^}]*color:var\(--dsw-alias-brand-primary\)/m)
})
