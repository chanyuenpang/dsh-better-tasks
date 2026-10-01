import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TASK_PREFERENCES,
  TASK_SETTINGS_ENTRY_ID,
  TASK_SETTINGS_NAMESPACE,
  createTaskPreferencesStore,
} from '../src/task-preferences.mjs'

// Contract fixture from desktop 0.2.0-rc.2 dsh-client-ui-settings:
// ConfigForms.get ensures its shared mirror asynchronously; controllers expose
// getSnapshot/subscribe/set (no load). Missing namespaces can be writable=true.
// set resolves false, rather than rejecting, after Host refusal and recovery.
function controller(initial = {}) {
  let snapshot = {
    status: 'loading', value: undefined, revision: undefined,
    writable: false, mode: 'host', ...initial,
  }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(next) {
      snapshot = { ...snapshot, ...next }
      for (const listener of listeners) listener()
    },
    set: () => Promise.resolve(true),
    get listenerCount() { return listeners.size },
  }
}

function readyForm(overrides = {}) {
  return controller({
    status: 'ready', value: { ...DEFAULT_TASK_PREFERENCES },
    writable: true, revision: 1, ...overrides,
  })
}

test('desktop settings namespace is the profile row options.id, not the Inspect loader id', () => {
  // Verified against 0.2.0-rc.2 dsh-settings/lib/index.js:443 and :502:
  // describe emits ns: entry.options.id; write finds row.options.id === ns.
  // Both generations therefore use the same unqualified profile row id here.
  assert.equal(TASK_SETTINGS_NAMESPACE, 'better-tasks-ui')
  assert.equal(TASK_SETTINGS_ENTRY_ID, TASK_SETTINGS_NAMESPACE)
  assert.notEqual(TASK_SETTINGS_ENTRY_ID, 'include:better-tasks-ui')
})

test('connect observes asynchronous form readiness without requiring form.load', async () => {
  const form = controller()
  const store = createTaskPreferencesStore()
  const disconnect = store.connect(form)
  assert.equal(form.load, undefined)
  assert.equal(store.source.getSnapshot().status, 'loading')
  assert.equal(store.source.getSnapshot().writable, false)
  await assert.rejects(store.set('sidebarView', 'tasks'), /not writable/)
  form.publish({ status: 'ready', value: { ...DEFAULT_TASK_PREFERENCES, sidebarView: 'tasks' }, writable: true, revision: 7 })
  assert.equal(store.source.getSnapshot().value.sidebarView, 'tasks')
  assert.equal(store.source.getSnapshot().revision, 7)
  assert.equal(store.source.getSnapshot().writable, true)
  disconnect()
  assert.equal(form.listenerCount, 0)
  assert.equal(store.source.getSnapshot().status, 'unavailable')
})

test('unserved namespace does not inherit document-level write permission', async () => {
  const store = createTaskPreferencesStore()
  const form = controller({ status: 'unavailable', writable: true })
  let writes = 0
  form.set = () => { writes++; return Promise.resolve(true) }
  store.connect(form)
  await assert.rejects(store.set('sidebarView', 'tasks'), /not writable/)
  assert.equal(writes, 0)
})

test('invalid ready form cannot write using fallback defaults', async () => {
  const store = createTaskPreferencesStore()
  store.connect(readyForm({ value: { ...DEFAULT_TASK_PREFERENCES, detailFontSize: 99 } }))
  assert.equal(store.source.getSnapshot().value, DEFAULT_TASK_PREFERENCES)
  await assert.rejects(store.set('detailFontSize', 14), /not writable/)
})

test('removed namespace becomes unwritable even if controller retains prior value', async () => {
  const form = readyForm()
  const store = createTaskPreferencesStore()
  store.connect(form)
  form.publish({ status: 'unavailable', writable: true })
  await assert.rejects(store.set('sidebarView', 'tasks'), /not writable/)
})

test('boolean false settlement rolls back optimistic state and rejects migration success', async () => {
  const store = createTaskPreferencesStore()
  const form = readyForm()
  let refuse
  form.set = () => new Promise(resolve => { refuse = resolve })
  store.connect(form)
  const write = store.set('sidebarView', 'tasks')
  assert.equal(store.source.getSnapshot().value.sidebarView, 'tasks')
  refuse(false)
  await assert.rejects(write, /rejected by Host/)
  assert.equal(store.source.getSnapshot().value.sidebarView, 'native')
})

test('false settlement preserves recovery read instead of stale pre-write value', async () => {
  const store = createTaskPreferencesStore()
  const form = readyForm()
  form.set = async () => {
    form.publish({ value: { ...DEFAULT_TASK_PREFERENCES, detailFontSize: 16 }, revision: 8 })
    return false
  }
  store.connect(form)
  await assert.rejects(store.set('detailFontSize', 14), /rejected by Host/)
  assert.equal(store.source.getSnapshot().value.detailFontSize, 16)
  assert.equal(store.source.getSnapshot().revision, 8)
})

test('boolean true and legacy void settlements both succeed', async () => {
  for (const accepted of [true, undefined]) {
    const store = createTaskPreferencesStore()
    const form = readyForm()
    const writes = []
    form.set = (field, value) => { writes.push([field, value]); return Promise.resolve(accepted) }
    store.connect(form)
    await store.set('sidebarView', 'tasks')
    assert.deepEqual(writes, [['sidebarView', 'tasks']])
    assert.equal(store.source.getSnapshot().value.sidebarView, 'tasks')
  }
})

test('synchronous controller failure is a rejected promise with rolled-back state', async () => {
  const store = createTaskPreferencesStore()
  const form = readyForm()
  form.set = () => { throw new Error('transport disconnected') }
  store.connect(form)
  await assert.rejects(store.set('sidebarView', 'tasks'), /transport disconnected/)
  assert.equal(store.source.getSnapshot().value.sidebarView, 'native')
})

test('old connection cleanup and rejected writes cannot reset a replacement connection', async () => {
  const store = createTaskPreferencesStore()
  const old = readyForm()
  let refuse
  old.set = () => new Promise(resolve => { refuse = resolve })
  const disconnectOld = store.connect(old)
  const write = store.set('sidebarView', 'tasks')
  const replacement = readyForm({ value: { ...DEFAULT_TASK_PREFERENCES, detailFontSize: 16 } })
  store.connect(replacement)
  disconnectOld()
  refuse(false)
  await assert.rejects(write, /rejected by Host/)
  assert.equal(old.listenerCount, 0)
  assert.equal(replacement.listenerCount, 1)
  assert.equal(store.source.getSnapshot().value.detailFontSize, 16)
})
