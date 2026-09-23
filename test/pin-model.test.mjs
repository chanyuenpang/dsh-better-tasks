import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PinQueueError,
  applyPinCommand,
  createEmptyPinQueue,
  prunePinQueue,
  publicPinQueue,
} from '../src/pin-model.mjs'

const T0 = '2026-09-23T00:00:00.000Z'
const T1 = '2026-09-23T00:01:00.000Z'

function command(action, sessionId, expectedRevision, beforeSessionId = undefined) {
  return { action, sessionId, expectedRevision, beforeSessionId }
}

test('pin queue appends, unpins, and preserves idempotent revisions', () => {
  const empty = createEmptyPinQueue(T0)
  const one = applyPinCommand(empty, command('pin', 's1', 0), T1)
  assert.deepEqual(publicPinQueue(one), {
    schemaVersion: 1,
    revision: 1,
    sessionIds: ['s1'],
    updatedAt: T1,
  })
  assert.equal(applyPinCommand(one, command('pin', 's1', 1), T1), one)
  const removed = applyPinCommand(one, command('unpin', 's1', 1), T1)
  assert.deepEqual(removed.sessionIds, [])
  assert.equal(removed.revision, 2)
  assert.equal(applyPinCommand(removed, command('unpin', 's1', 2), T1), removed)
})

test('pin-created appends idempotently under the same revision-CAS model', () => {
  const empty = createEmptyPinQueue(T0)
  const created = applyPinCommand(empty, command('pin-created', 'blank-session', 0), T1)
  assert.deepEqual(created.sessionIds, ['blank-session'])
  assert.equal(created.revision, 1)
  assert.equal(applyPinCommand(created, command('pin-created', 'blank-session', 1), T1), created)
})

test('move follows DOM insert-before semantics and never sorts by timestamps', () => {
  let queue = createEmptyPinQueue(T0)
  for (const id of ['a', 'b', 'c']) queue = applyPinCommand(queue, command('pin', id, queue.revision), T1)
  const before = applyPinCommand(queue, command('move', 'c', queue.revision, 'a'), T1)
  assert.deepEqual(before.sessionIds, ['c', 'a', 'b'])
  const appended = applyPinCommand(before, command('move', 'c', before.revision, null), T1)
  assert.deepEqual(appended.sessionIds, ['a', 'b', 'c'])
})

test('revision conflicts and invalid anchors fail with stable codes', () => {
  const queue = applyPinCommand(createEmptyPinQueue(T0), command('pin', 'a', 0), T1)
  assert.throws(
    () => applyPinCommand(queue, command('pin', 'b', 0), T1),
    (error) => error instanceof PinQueueError && error.code === 'better-tasks/revision-conflict',
  )
  assert.throws(
    () => applyPinCommand(queue, command('move', 'a', 1, 'missing'), T1),
    (error) => error instanceof PinQueueError && error.code === 'better-tasks/anchor-not-pinned',
  )
})

test('pruning removes ineligible sessions without reordering survivors', () => {
  let queue = createEmptyPinQueue(T0)
  for (const id of ['a', 'b', 'c']) queue = applyPinCommand(queue, command('pin', id, queue.revision), T1)
  const pruned = prunePinQueue(queue, new Set(['c', 'a']), T1)
  assert.deepEqual(pruned.sessionIds, ['a', 'c'])
  assert.equal(pruned.revision, queue.revision + 1)
  assert.equal(prunePinQueue(pruned, ['a', 'c'], T1), pruned)
})

test('public snapshots detach the mutable session id array', () => {
  const queue = applyPinCommand(createEmptyPinQueue(T0), command('pin', 'a', 0), T1)
  const snapshot = publicPinQueue(queue)
  snapshot.sessionIds.push('mutated')
  assert.deepEqual(queue.sessionIds, ['a'])
})
