import assert from 'node:assert/strict'
import test from 'node:test'
import { expandFinalForIdleCycles, isNewFinalIdleCycle, isProjectionExpanded, parseFinalMessageCache, reconcileGoalExpansionCycles, reconcileTodoExpansionCycles, todoExpansionCycle, serializeFinalMessageCache } from '../src/client.js'

const idle = (id, updatedAt, current = false) => ({ id, updatedAt, current })

test('a new idle cycle clears Final and input overrides but leaves Goal and Todo independent', () => {
  const existing = { 'session-a:goal': true, 'session-a:final': false, 'session-a:input': false, 'session-a:todo': true }
  const result = expandFinalForIdleCycles({}, [idle('session-a', 10), idle('session-b', 20)], existing)
  assert.deepEqual(result.expanded, { 'session-a:goal': true, 'session-a:todo': true })
  assert.deepEqual(result.cycles, { 'session-a': 10, 'session-b': 20 })
  assert.equal(isProjectionExpanded(result.expanded, 'session-a:input', true), true)
  assert.equal(isProjectionExpanded(result.expanded, 'session-a:input', false), false)
  assert.equal(isProjectionExpanded(result.expanded, 'session-a:final', true), true)
  assert.equal(isProjectionExpanded(result.expanded, 'session-b:final', false), false)
})

test('manual Final collapse survives remounts during the same idle cycle', () => {
  const collapsed = { 'session-a:final': false, 'session-a:input': true }
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

test('restart cold metadata fallback and later hydration preserve manual Final/input state and watermark', () => {
  const cycles = { a: 100, b: 100 }
  const manual = { 'a:final': false, 'a:input': true, 'b:final': true, 'b:input': false }
  const cold = expandFinalForIdleCycles(cycles, [idle('a', 10), idle('b', 20)], manual)
  assert.equal(cold.cycles, cycles)
  assert.equal(cold.expanded, manual)
  const warm = expandFinalForIdleCycles(cold.cycles, [idle('a', 100), idle('b', 100)], cold.expanded)
  assert.equal(warm.cycles, cycles)
  assert.equal(warm.expanded, manual)
  assert.equal(isProjectionExpanded(warm.expanded, 'a:final', true), false)
  assert.equal(isProjectionExpanded(warm.expanded, 'b:final', false), true)
})

test('a genuinely newer native activity still resets defaults after a restored cold cycle', () => {
  const restored = { cycles: { a: 100 }, expanded: { 'a:final': false, 'a:input': true } }
  assert.equal(isNewFinalIdleCycle(restored.cycles, idle('a', 10)), false)
  assert.equal(isNewFinalIdleCycle(restored.cycles, idle('a', 100)), false)
  assert.equal(isNewFinalIdleCycle(restored.cycles, idle('a', 101)), true)
  const newer = expandFinalForIdleCycles(restored.cycles, [idle('a', 101)], restored.expanded)
  assert.deepEqual(newer.cycles, { a: 101 })
  assert.deepEqual(newer.expanded, {})
  assert.equal(isProjectionExpanded(newer.expanded, 'a:final', true), true)
})

test('unknown or invalid activity cannot consume a cycle or destroy disclosure choices', () => {
  const cycles = { a: 100 }, manual = { 'a:final': false }
  for (const updatedAt of [undefined, null, NaN, Infinity, -1]) {
    const result = expandFinalForIdleCycles(cycles, [idle('a', updatedAt)], manual)
    assert.equal(result.cycles, cycles)
    assert.equal(result.expanded, manual)
  }
})

test('current-cycle suppression persists through restart fallback, hydration and navigation', () => {
  const saved = expandFinalForIdleCycles({}, [idle('a', 100, true)], {})
  const restart = JSON.parse(JSON.stringify(saved))
  const cold = expandFinalForIdleCycles(restart.cycles, [idle('a', 10, false)], restart.expanded)
  const warm = expandFinalForIdleCycles(cold.cycles, [idle('a', 100, false)], cold.expanded)
  assert.equal(warm.expanded['a:final'], false)
  assert.equal(warm.cycles.a, 100)
})

test('a newly idle current card consumes the cycle but suppresses the automatic Final default', () => {
  const next = expandFinalForIdleCycles({ a: 9 }, [idle('a', 10, true), idle('b', 10)], { 'a:input': true, 'a:todo': true })
  assert.deepEqual(next.cycles, { a: 10, b: 10 })
  assert.equal(next.expanded['a:final'], false)
  assert.equal(isProjectionExpanded(next.expanded, 'a:final', true), false)
  assert.equal(isProjectionExpanded(next.expanded, 'b:final', true), true)
  assert.equal(isProjectionExpanded(next.expanded, 'b:final', false), false)
  assert.equal(next.expanded['a:input'], undefined)
  assert.equal(next.expanded['a:todo'], true)
})

test('same-cycle navigation and refresh do not retroactively open or fold Final', () => {
  const start = expandFinalForIdleCycles({}, [idle('a', 10, true)], {})
  const leave = expandFinalForIdleCycles(start.cycles, [idle('a', 10, false)], start.expanded)
  assert.equal(leave.expanded, start.expanded)
  assert.equal(leave.expanded['a:final'], false)
  const remount = expandFinalForIdleCycles(JSON.parse(JSON.stringify(start.cycles)), [idle('a', 10)], JSON.parse(JSON.stringify(start.expanded)))
  assert.equal(isProjectionExpanded(remount.expanded, 'a:final', true), false)
  // A background task which was automatically open stays open when selected.
  const background = expandFinalForIdleCycles({}, [idle('b', 10)], {})
  const select = expandFinalForIdleCycles(background.cycles, [idle('b', 10, true)], background.expanded)
  assert.equal(isProjectionExpanded(select.expanded, 'b:final', true), true)
})

test('current-cycle automatic suppression never force-folds an explicit manual expansion', () => {
  const existing = { 'a:final': true, 'a:input': true, 'a:goal': true }
  const next = expandFinalForIdleCycles({ a: 9 }, [idle('a', 10, true)], existing)
  assert.equal(next.expanded['a:final'], true)
  assert.equal(next.expanded['a:input'], undefined)
  assert.equal(next.expanded['a:goal'], true)
})

test('a manual opening after suppression wins while a later background cycle returns to defaults', () => {
  const next = expandFinalForIdleCycles({}, [idle('a', 10, true)], {})
  const manual = { ...next.expanded, 'a:final': true }
  assert.equal(expandFinalForIdleCycles(next.cycles, [idle('a', 10, true)], manual).expanded, manual)
  const later = expandFinalForIdleCycles(next.cycles, [idle('a', 11, false)], next.expanded)
  assert.equal(later.expanded['a:final'], undefined)
  assert.equal(isProjectionExpanded(later.expanded, 'a:final', true), true)
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

const todoTask = (goalId = 'g1', contents = ['first', 'second'], status = 'pending') => ({
  id: 'session-a',
  goal: goalId === null ? { availability: 'none' } : { availability: 'ready', id: goalId },
  todos: { availability: 'ready', items: contents.map(content => ({ content, status })) },
})

test('Todo choices survive progress, rename, timestamp changes and serialized refresh', () => {
  const original = todoTask()
  const cycles = { 'session-a': todoExpansionCycle(original) }
  const expanded = { 'session-a:todo': false }
  const progressed = { ...todoTask('g1', ['first', 'second'], 'completed'), title: 'renamed', updatedAt: 99 }
  const next = reconcileTodoExpansionCycles(cycles, [progressed], expanded)
  assert.equal(next.cycles, cycles)
  assert.equal(next.expanded, expanded)
  const refreshed = reconcileTodoExpansionCycles(JSON.parse(JSON.stringify(cycles)), [progressed], JSON.parse(JSON.stringify(expanded)))
  assert.equal(isProjectionExpanded(refreshed.expanded, 'session-a:todo', true), false)
})

test('Todo new goal, new list, completed goal or empty list resets only Todo to either default', () => {
  const cycles = { 'session-a': todoExpansionCycle(todoTask()) }
  for (const task of [todoTask('g2'), todoTask('g1', ['replacement']), todoTask(null), todoTask('g1', [])]) {
    const expanded = { 'session-a:todo': false, 'session-a:goal': true, 'session-a:final': false, 'session-a:input': true }
    const next = reconcileTodoExpansionCycles(cycles, [task], expanded)
    assert.equal(next.expanded['session-a:todo'], undefined)
    assert.equal(isProjectionExpanded(next.expanded, 'session-a:todo', true), true)
    assert.equal(isProjectionExpanded(next.expanded, 'session-a:todo', false), false)
    assert.deepEqual(next.expanded, { 'session-a:goal': true, 'session-a:final': false, 'session-a:input': true })
  }
})

test('unknown Goal/Todo projections do not erase choices or cycle identity', () => {
  const cycles = { 'session-a': todoExpansionCycle(todoTask()) }
  const expanded = { 'session-a:todo': true }
  for (const task of [{ ...todoTask(), goal: { availability: 'unknown' } }, { ...todoTask(), todos: { availability: 'unknown' } }]) {
    const next = reconcileTodoExpansionCycles(cycles, [task], expanded)
    assert.equal(next.cycles, cycles)
    assert.equal(next.expanded, expanded)
  }
})

test('pre-fix Todo override is retired once when its first scoped lifecycle is known', () => {
  const task = todoTask(null)
  const initial = reconcileTodoExpansionCycles({}, [task], { 'session-a:todo': true })
  assert.equal(isProjectionExpanded(initial.expanded, 'session-a:todo', false), false)
  const manual = { ...initial.expanded, 'session-a:todo': true }
  assert.equal(reconcileTodoExpansionCycles(initial.cycles, [task], manual).expanded, manual)
})

test('Goal, Todo and idle reset updates compose without resurrecting other overrides', () => {
  const old = { 'session-a:goal': true, 'session-a:todo': true, 'session-a:final': false, 'session-a:input': false }
  const goal = reconcileGoalExpansionCycles({ 'session-a': 'g1' }, [{ id: 'session-a', goalId: 'g2' }], [], old)
  const todo = reconcileTodoExpansionCycles({ 'session-a': todoExpansionCycle(todoTask()) }, [todoTask('g2')], goal.expanded)
  const end = expandFinalForIdleCycles({ 'session-a': 1 }, [idle('session-a', 2)], todo.expanded)
  assert.deepEqual(end.expanded, {})
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
