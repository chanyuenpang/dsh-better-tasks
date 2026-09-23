import assert from 'node:assert/strict'
import test from 'node:test'
import { expandFinalForIdleCycles, parseFinalMessageCache, reconcileGoalExpansionCycles, serializeFinalMessageCache } from '../src/client.js'

const idle = (id, updatedAt) => ({ id, updatedAt })

test('Final auto-expands once for the first observed idle cycle', () => {
  const existing = { 'session-a:goal': true }
  const result = expandFinalForIdleCycles({}, [idle('session-a', 10), idle('session-b', 20)], existing)
  assert.deepEqual(result.expanded, {
    'session-a:goal': true,
    'session-a:final': true,
    'session-b:final': true,
  })
  assert.deepEqual(result.cycles, { 'session-a': 10, 'session-b': 20 })
})

test('manual collapse survives remounts during the same idle cycle', () => {
  const collapsed = {}
  const cycles = { 'session-a': 10 }
  const result = expandFinalForIdleCycles(cycles, [idle('session-a', 10)], collapsed)
  assert.equal(result.expanded, collapsed)
  assert.equal(result.cycles, cycles)
  assert.equal(result.expanded['session-a:final'], undefined)
})

test('a later idle cycle reopens Final', () => {
  const result = expandFinalForIdleCycles({ 'session-a': 10 }, [idle('session-a', 11)], {})
  assert.equal(result.expanded['session-a:final'], true)
  assert.equal(result.cycles['session-a'], 11)
})

test('Goal auto-expands once and manual collapse survives the same goal lifecycle', () => {
  const first = reconcileGoalExpansionCycles({}, [{ id: 'session-a', goalId: 'goal-1' }], [], {})
  assert.equal(first.expanded['session-a:goal'], true)
  assert.equal(first.cycles['session-a'], 'goal-1')

  const collapsed = {}
  const remount = reconcileGoalExpansionCycles(first.cycles, [{ id: 'session-a', goalId: 'goal-1' }], [], collapsed)
  assert.equal(remount.expanded, collapsed)
  assert.equal(remount.cycles, first.cycles)
})

test('Goal completion clears its cycle and a later Goal opens again', () => {
  const ended = reconcileGoalExpansionCycles({ 'session-a': 'goal-1' }, [], ['session-a'], { 'session-a:goal': true })
  assert.deepEqual(ended.cycles, {})
  assert.deepEqual(ended.expanded, {})

  const next = reconcileGoalExpansionCycles(ended.cycles, [{ id: 'session-a', goalId: 'goal-2' }], [], ended.expanded)
  assert.equal(next.expanded['session-a:goal'], true)
  assert.equal(next.cycles['session-a'], 'goal-2')
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
