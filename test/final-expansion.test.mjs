import assert from 'node:assert/strict'
import test from 'node:test'
import { expandFinalForIdleCycles, isProjectionExpanded, parseFinalMessageCache, reconcileGoalExpansionCycles, serializeFinalMessageCache } from '../src/client.js'

const idle = (id, updatedAt) => ({ id, updatedAt })

test('a new idle cycle clears only the prior Final override and uses the configured default', () => {
  const existing = { 'session-a:goal': true, 'session-a:final': false }
  const result = expandFinalForIdleCycles({}, [idle('session-a', 10), idle('session-b', 20)], existing)
  assert.deepEqual(result.expanded, { 'session-a:goal': true })
  assert.deepEqual(result.cycles, { 'session-a': 10, 'session-b': 20 })
  assert.equal(isProjectionExpanded(result.expanded, 'session-a:final', true), true)
  assert.equal(isProjectionExpanded(result.expanded, 'session-b:final', false), false)
})

test('manual Final collapse survives remounts during the same idle cycle', () => {
  const collapsed = { 'session-a:final': false }
  const cycles = { 'session-a': 10 }
  const result = expandFinalForIdleCycles(cycles, [idle('session-a', 10)], collapsed)
  assert.equal(result.expanded, collapsed)
  assert.equal(result.cycles, cycles)
  assert.equal(isProjectionExpanded(result.expanded, 'session-a:final', true), false)
})

test('a later idle cycle forgets the prior manual Final override', () => {
  const result = expandFinalForIdleCycles({ 'session-a': 10 }, [idle('session-a', 11)], { 'session-a:final': false })
  assert.equal(result.expanded['session-a:final'], undefined)
  assert.equal(result.cycles['session-a'], 11)
  assert.equal(isProjectionExpanded(result.expanded, 'session-a:final', true), true)
})

test('Goal defaults to collapsed and a manual choice survives the same goal lifecycle', () => {
  const first = reconcileGoalExpansionCycles({}, [{ id: 'session-a', goalId: 'goal-1' }], [], {})
  assert.equal(first.expanded['session-a:goal'], undefined)
  assert.equal(isProjectionExpanded(first.expanded, 'session-a:goal', false), false)
  assert.equal(first.cycles['session-a'], 'goal-1')

  const opened = { 'session-a:goal': true }
  const remount = reconcileGoalExpansionCycles(first.cycles, [{ id: 'session-a', goalId: 'goal-1' }], [], opened)
  assert.equal(remount.expanded, opened)
  assert.equal(remount.cycles, first.cycles)
})

test('Goal completion and a new Goal clear the previous projection override', () => {
  const ended = reconcileGoalExpansionCycles({ 'session-a': 'goal-1' }, [], ['session-a'], { 'session-a:goal': true })
  assert.deepEqual(ended.cycles, {})
  assert.deepEqual(ended.expanded, {})

  const next = reconcileGoalExpansionCycles({ 'session-a': 'goal-1' }, [{ id: 'session-a', goalId: 'goal-2' }], [], { 'session-a:goal': true })
  assert.equal(next.expanded['session-a:goal'], undefined)
  assert.equal(next.cycles['session-a'], 'goal-2')
  assert.equal(isProjectionExpanded(next.expanded, 'session-a:goal', false), false)
})

test('Todo and Goal defaults resolve independently', () => {
  const value = { 'session-a:goal': false, 'session-a:todo': true }
  assert.equal(isProjectionExpanded(value, 'session-a:goal', true), false)
  assert.equal(isProjectionExpanded(value, 'session-a:todo', false), true)
  assert.equal(isProjectionExpanded({}, 'session-a:goal', false), false)
  assert.equal(isProjectionExpanded({}, 'session-a:todo', true), true)
})

test('Final cache round-trips only ready bounded text projections', () => {
  const states = {
    'session-a': {
      status: 'ready',
      updatedAt: 10,
      value: {
        sessionId: 'session-a',
        asOfSeq: 4,
        final: { seq: 3, turn: 2, text: 'done', interrupted: false, endReason: 'completed' },
        truncated: false,
        totalCodePoints: 4,
      },
    },
    'session-loading': { status: 'loading', updatedAt: 12 },
  }
  assert.deepEqual(parseFinalMessageCache(serializeFinalMessageCache(states)), { 'session-a': states['session-a'] })
})

test('Final cache rejects malformed and oversized payloads', () => {
  assert.deepEqual(parseFinalMessageCache('{broken'), {})
  const raw = JSON.stringify({
    'session-a': {
      status: 'ready',
      updatedAt: 1,
      value: { sessionId: 'session-a', final: { text: 'x'.repeat(4001) } },
    },
  })
  assert.deepEqual(parseFinalMessageCache(raw), {})
})
