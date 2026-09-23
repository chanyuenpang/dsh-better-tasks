import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TASK_PREFERENCES,
  createTaskPreferencesStore,
  decodeTaskPreferences,
} from '../src/task-preferences.mjs'

const configured = Object.freeze({
  detailFontSize: 15,
  defaultTodoExpanded: true,
  defaultGoalExpanded: false,
  defaultFinalExpanded: false,
  columnLayout: 'single',
})

function fakeScope(initial) {
  let snapshot = initial
  const listeners = new Set()
  const writes = []
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(field, value) {
      writes.push([field, value])
      return Promise.resolve()
    },
    publish(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    writes,
  }
}

test('decodes only complete bounded Better Tasks preferences', () => {
  assert.deepEqual(decodeTaskPreferences(configured), configured)
  assert.equal(decodeTaskPreferences({ ...configured, detailFontSize: 17 }), undefined)
  assert.equal(decodeTaskPreferences({ ...configured, columnLayout: 'wide' }), undefined)
  assert.equal(decodeTaskPreferences({ ...configured, defaultGoalExpanded: 'no' }), undefined)
})

test('uses non-blocking defaults until the optional settings scope is ready', () => {
  const store = createTaskPreferencesStore()
  assert.deepEqual(store.source.getSnapshot(), {
    status: 'unavailable',
    value: DEFAULT_TASK_PREFERENCES,
    revision: undefined,
    writable: false,
    mode: 'memory',
  })
  const scope = fakeScope({ status: 'loading', value: undefined, revision: undefined, writable: false, mode: 'host' })
  const disconnect = store.connect(scope)
  assert.equal(store.source.getSnapshot().status, 'loading')
  assert.equal(store.source.getSnapshot().value, DEFAULT_TASK_PREFERENCES)
  scope.publish({ status: 'ready', value: configured, revision: 4, writable: true, mode: 'host' })
  assert.deepEqual(store.source.getSnapshot().value, configured)
  assert.equal(store.source.getSnapshot().revision, 4)
  disconnect()
  assert.equal(store.source.getSnapshot().status, 'unavailable')
  assert.equal(store.source.getSnapshot().value, DEFAULT_TASK_PREFERENCES)
})

test('rolls an optimistic preference back when the Host write fails', async () => {
  const store = createTaskPreferencesStore()
  const scope = fakeScope({ status: 'ready', value: configured, revision: 2, writable: true, mode: 'host' })
  scope.set = () => Promise.reject(new Error('write failed'))
  store.connect(scope)
  const write = store.set('detailFontSize', 14)
  assert.equal(store.source.getSnapshot().value.detailFontSize, 14)
  await assert.rejects(write, /write failed/)
  assert.equal(store.source.getSnapshot().value.detailFontSize, 15)
})

test('routes validated field writes only through a writable bound scope', async () => {
  const store = createTaskPreferencesStore()
  await assert.rejects(store.set('detailFontSize', 14), /not writable/)
  const scope = fakeScope({ status: 'ready', value: configured, revision: 2, writable: true, mode: 'host' })
  store.connect(scope)
  const write = store.set('detailFontSize', 14)
  assert.equal(store.source.getSnapshot().value.detailFontSize, 14)
  await write
  assert.deepEqual(scope.writes, [['detailFontSize', 14]])
  await assert.rejects(store.set('detailFontSize', 17), /invalid Better Tasks setting/)
  await assert.rejects(store.set('unknown', true), /unknown Better Tasks setting/)
})
