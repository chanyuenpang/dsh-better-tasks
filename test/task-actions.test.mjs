import { test } from 'node:test'
import assert from 'node:assert/strict'
import { continueIdleTask, renameTaskSession } from '../src/task-actions.mjs'

function binding(goal, calls, overrides = {}) {
  return { session: {
    sessionId: 's-1',
    getSnapshot: () => ({ running: false, pendingInteraction: null, ...overrides }),
    projections: { faceOf: () => ({ getSnapshot: () => goal }) },
    prompt: async (content, mode) => { calls.push(['prompt', content, mode]); return { ok: true } },
    rename: async (title) => { calls.push(['rename', title]); return { ok: true } },
  } }
}

test('idle prompt steers exact text before resuming a current Goal', async () => {
  const calls = []
  const goal = { goal: { id: 'g-1', revision: 3, phase: 'paused' } }
  const result = await continueIdleTask({ binding: binding(goal, calls), text: '继续做', goals: {
    resume: async (...args) => { calls.push(['resume', ...args]); return { ok: true } },
  } })
  assert.deepEqual(calls, [
    ['prompt', [{ type: 'text', text: '继续做' }], 'steer'],
    ['resume', 's-1', { id: 'g-1', revision: 3 }],
  ])
  assert.deepEqual(result, { warning: null })
})

test('no Goal sends directly; resume failure warns after sending; invalid state never sends', async () => {
  const calls = []
  const session = binding(null, calls)
  await continueIdleTask({ binding: session, text: '继续' })
  assert.equal(calls.length, 1)
  calls.length = 0
  const result = await continueIdleTask({ binding: binding({ goal: { id: 'g', revision: 1, phase: 'active' } }, calls), text: '继续', goals: {
    resume: async () => ({ ok: false, error: { message: 'stale goal' } }),
  } })
  assert.deepEqual(result, { warning: 'stale goal' })
  assert.equal(calls.length, 1)
  calls.length = 0
  await assert.rejects(continueIdleTask({ binding: binding(null, calls, { running: true }), text: '继续' }), /no longer idle/)
  await assert.rejects(continueIdleTask({ binding: session, text: '  ' }), /empty/)
  assert.equal(calls.length, 0)
})

test('failed prompt is not misreported as Goal warning', async () => {
  let resumed = false
  const current = binding({ goal: { id: 'g', revision: 1, phase: 'active' } }, [])
  current.session.prompt = async () => ({ ok: false, error: { message: 'delivery failed' } })
  await assert.rejects(continueIdleTask({ binding: current, text: '继续', goals: {
    resume: async () => { resumed = true; return { ok: true } },
  } }), /delivery failed/)
  assert.equal(resumed, false)
})

test('rename delegates to native session binding', async () => {
  const calls = []
  await renameTaskSession({ binding: binding(null, calls), title: '  新标题  ' })
  assert.deepEqual(calls, [['rename', '新标题']])
  await assert.rejects(renameTaskSession({ binding: binding(null, calls), title: '  ' }), /empty/)
})
