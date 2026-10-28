import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { createTaskExecutionProjection, foldTaskExecution } from '../src/task-execution.mjs'
import { taskExecutionWarning } from '../src/task-model.mjs'

const start = (turn = 1) => ({ type: 'turn/start', data: { turn } })
const end = (kind, extra = {}, turn = 1) => ({ type: 'turn/end', data: { turn, reason: { kind, ...extra } } })
const summary = (state, running = false) => ({ running, projectionValues: { betterTasksExecution: state } })
const warning = (state, running = false, pending, connection = 'connected', ready = true) =>
  taskExecutionWarning(summary(state, running), pending, connection, ready)

for (const kind of ['error', 'aborted', 'interrupted', 'max-tokens']) {
  test(`${kind} becomes a warning without changing execution`, () => {
    const event = end(kind, kind === 'error' ? { error: { message: '网络连接关闭' } } : {})
    const state = foldTaskExecution(foldTaskExecution(null, start()), event)
    assert.equal(warning(state).kind, kind)
    assert.equal(state.phase, 'ended')
    assert.equal(warning(state, true), null, 'new live execution suppresses old failure')
    assert.equal(warning(state, false, { kind: 'question' }), null)
    assert.equal(warning(state, false, { kind: 'approval' }), null)
    assert.equal(warning(state, false, { kind: 'plan-review' }), null)
    assert.equal(warning(state, false, undefined, 'connected', false), null)
  })
}

for (const kind of ['completed', 'blocked', 'forked', 'future-reason']) {
  test(`${kind} is not an execution failure`, () => {
    assert.equal(warning(foldTaskExecution(null, end(kind))), null)
  })
}

test('disconnected/reconnecting are explicitly unknown, not stopped or idle success', () => {
  for (const connection of ['connecting', 'disconnected']) {
    for (const state of [null, foldTaskExecution(null, start()), foldTaskExecution(null, end('completed'))]) {
      assert.equal(warning(state, true, undefined, connection).kind, 'disconnected')
    }
  }
  assert.equal(warning(null), null)
  assert.equal(taskExecutionWarning({ running: false }, undefined, undefined), null)
  assert.equal(warning(foldTaskExecution(null, end('completed')), false, undefined, 'connected'), null)
})

test('a persisted open turn is interrupted only with a ready idle catalog', () => {
  const state = foldTaskExecution(null, start())
  assert.equal(warning(state).kind, 'interrupted')
  assert.equal(warning(state, true), null)
  assert.equal(warning(state, false, undefined, 'connected', false), null)
})

test('new turn, successful end, reload and unrelated events have correct lifetimes', () => {
  const failed = foldTaskExecution(null, end('error', { error: { message: 'failed' } }))
  assert.equal(warning(JSON.parse(JSON.stringify(failed))).kind, 'error')
  assert.equal(foldTaskExecution(failed, { type: 'tool/result', data: {} }), failed)
  assert.equal(foldTaskExecution(failed, { type: 'user/message', data: {} }), failed, 'queued input does not claim recovery')
  const next = foldTaskExecution(failed, start(2))
  assert.equal(warning(next, true), null)
  assert.equal(foldTaskExecution(next, end('error', {}, 1)), next)
  assert.equal(warning(foldTaskExecution(next, end('completed', {}, 2))), null)
})

test('projection is bounded, JSON-checkpointable and schema-valid', () => {
  const projection = createTaskExecutionProjection(z)
  assert.equal(projection.key, 'betterTasksExecution')
  assert.equal(projection.stateVersion, 1)
  assert.equal(projection.init(), null)
  const state = projection.apply(null, end('error', { error: { message: '😀'.repeat(900) } }))
  assert.equal(Array.from(state.detail).length, 800)
  assert.equal(projection.wire.view(state), state)
  assert.deepEqual(projection.stateSchema.parse(JSON.parse(JSON.stringify(state))), state)
  assert.deepEqual(projection.wire.viewSchema.parse(state), state)
  const hooked = foldTaskExecution(null, end('aborted', { reason: { kind: 'hook', reason: 'policy stopped' } }))
  assert.equal(hooked.detail, 'policy stopped')
})

test('warning reuses whole-card state colors and a compact title icon without a banner', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const card = source.slice(source.indexOf("return element('article'"), source.indexOf('function SidebarRegion'))
  assert.match(card, /'data-execution-warning': executionWarning\?\.kind/)
  assert.doesNotMatch(source, /dbt-execution-warning|warning-copy/)
  assert.match(card, /className: 'dbt-task-error-icon', width: 14, height: 14/)
  assert.ok(card.indexOf("className: 'dbt-task-error-icon'") < card.indexOf("className: 'dbt-task-projection-bar'"))
  assert.match(card, /'aria-label': `\$\{projectName\}: \$\{stateLabel\}`/)
  assert.match(card, /title: stateLabel/)
  assert.match(source, /\[warningLabel, executionWarning.detail\]\.filter\(Boolean\)\.join\('\\n'\)/)
  const red = source.match(/\.dbt-task-card\[data-execution-warning\]\{([^}]+)\}/)[1]
  const green = source.match(/\.dbt-task-card\[data-state="running"\]\{([^}]+)\}/)[1]
  assert.equal(red.replaceAll('var(--dsw-alias-state-error-primary)', 'COLOR'), green.replaceAll('var(--dsw-alias-success,#1f9d62)', 'COLOR'))
  assert.match(source, /\.dbt-task-card\[data-current="true"\]\[data-execution-warning\]\{--dbt-task-bg:color-mix\(in srgb,var\(--dsw-alias-state-error-primary\) 17%/)
  assert.match(source, /\.dbt-task-error-icon\{flex:none;color:var\(--dsw-alias-state-error-primary\)/)
  assert.match(source, /'tasks.execution.disconnected': '连接已断开 · 任务状态未知'/)
  assert.match(source, /'tasks.execution.error': 'Execution failed'/)
  assert.match(source, /taskConnection = ctx.get\?\.\('connection'\)\?\.state \?\? createSnapshotStore\(undefined\)/)
  assert.match(source, /const connectionState = useTaskConnection\(\(snapshot\) => snapshot\)/)
  const host = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  assert.match(host, /ctx.inject\(\['sessionProjections'\]/)
  assert.match(host, /sessionProjections.register\(createTaskExecutionProjection\(z\)\)/)
})
