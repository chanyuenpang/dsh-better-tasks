import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, BetterSidebarRoot, SidebarRootGuard, SidebarReopenControls } from '../src/client.js'
import { DEFAULT_TASK_PREFERENCES } from '../src/task-preferences.mjs'

function createContext(panelEntries = []) {
  const effects = []
  const subscriptions = []
  const registrations = []
  const injections = []
  const calls = []
  const ctx = {
    effect(install) {
      effects.push(install())
      return () => {}
    },
    provide(name, value) {
      calls.push(['provide', name])
      ctx[name] = value
      return () => { delete ctx[name] }
    },
    inject(services, callback) {
      calls.push(['inject', ...services])
      // The settings probes are per-generation guards: 0.1.5 serves settingsScope,
      // 0.2 serves configForms. This fixture provides neither, so both stay
      // deferred — which is exactly the non-blocking behaviour under test.
      if (services.length === 1 && (services[0] === 'settingsScope' || services[0] === 'configForms')) return () => {}
      assert.deepEqual(services, ['uiWorkspace'])
      return callback(ctx)
    },
    locale: {
      register(namespace, dictionaries) {
        calls.push(['locale.register', namespace, Object.keys(dictionaries)])
        return () => {}
      },
      subscribe(listener) {
        subscriptions.push(['locale', listener])
        return () => {}
      },
    },
    layout: {
      toggleSidebar() { calls.push(['layout.toggleSidebar']) },
      selectPanel(id) { calls.push(['layout.selectPanel', id]) },
    },
    uiWorkspace: {
      startSession(id) { calls.push(['uiWorkspace.startSession', id]) },
      openSession(id) { calls.push(['uiWorkspace.openSession', id]) },
      onSessionCreated(listener) {
        calls.push(['uiWorkspace.onSessionCreated'])
        subscriptions.push(['session-created', listener])
        return () => {}
      },
    },
    slots: {
      entriesOfSlot(name) {
        assert.equal(name, 'sidebar.panellist')
        return panelEntries
      },
      subscribe(name, listener) {
        subscriptions.push([name, listener])
        return () => {}
      },
      inject(name, install) {
        injections.push(name)
        return install()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, effects, subscriptions, registrations, injections, calls }
}

test('registers one root replacement and declares all compatibility seats', () => {
  const fixture = createContext([
    { options: { id: 'zeta', order: 20, label: 'Zeta' } },
    { options: { id: 'alpha', order: 10, label: () => 'Alpha' } },
  ])
  apply(fixture.ctx)

  assert.deepEqual(fixture.injections, ['sidebar', 'shell.leading'])
  assert.equal(fixture.registrations.filter(row => row.options.name === 'sidebar').length, 1)
  assert.equal(fixture.registrations.length, 2)
  const [{ options, component }] = fixture.registrations
  assert.equal(options.name, 'sidebar')
  assert.equal(options.priority, undefined)
  assert.equal(options.locale, 'better-tasks-sidebar')
  assert.equal(component, SidebarRootGuard)
  assert.deepEqual(options.children, {
    'sidebar.brand.mark': { kind: 'single', scope: 'root' },
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  })

  const injected = options.inject()
  assert.equal(typeof injected.startSession, 'function')
  assert.equal(typeof injected.toggleSidebar, 'function')
  assert.equal(typeof injected.selectPanel, 'function')
  assert.equal(typeof injected.openSession, 'function')
  assert.equal(typeof injected.moveTaskBefore, 'function')
  assert.equal(typeof injected.setTaskPreference, 'function')
  assert.equal(injected.hooks.panels.getSnapshot().length, 2)
  assert.equal(typeof injected.hooks.taskPins.getSnapshot, 'function')
  assert.equal(typeof injected.hooks.taskPreferences.getSnapshot, 'function')
  assert.equal(injected.hooks.taskPreferences.getSnapshot().value.defaultGoalExpanded, false)
  assert.deepEqual(injected.hooks.panels.getSnapshot().map((panel) => panel.id), ['alpha', 'zeta'])

  injected.startSession('workspace-1')
  injected.toggleSidebar()
  injected.selectPanel('alpha')
  injected.openSession('session-1')
  assert.deepEqual(fixture.calls.slice(-4), [
    ['uiWorkspace.startSession', 'workspace-1'],
    ['layout.toggleSidebar'],
    ['layout.selectPanel', 'alpha'],
    ['uiWorkspace.openSession', 'session-1'],
  ])
})

test('restores the legal outside-column shell seat using native actions and no new root declaration', () => {
  const fixture = createContext()
  apply(fixture.ctx)
  const shell = fixture.registrations.find(row => row.options.name === 'shell.leading')
  assert.equal(shell.component, SidebarReopenControls)
  assert.equal(shell.options.locale, 'better-tasks-sidebar')
  assert.equal(shell.options.priority, undefined)
  assert.equal(shell.options.children, undefined)
  const actions = shell.options.inject()
  actions.toggleSidebar()
  actions.startSession()
  assert.deepEqual(fixture.calls.slice(-2), [['layout.toggleSidebar'], ['uiWorkspace.startSession', undefined]])
  assert.equal(fixture.registrations.some(row => row.options.name === 'root'), false)
})

test('desktop view action uses the settings namespace and migrates only after load', async () => {
  const fixture = createContext()
  const values = new Map([['dsh-better-tasks.view', 'tasks']])
  const previousStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  let snapshot = { status: 'loading', writable: false, value: undefined }
  const listeners = new Set(), writes = [], ids = []
  const form = {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    async set(field, value) {
      writes.push([field, value])
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
      for (const fn of listeners) fn()
      return true
    },
  }
  fixture.ctx.configForms = { get(id) { ids.push(id); return form } }
  const originalInject = fixture.ctx.inject
  fixture.ctx.inject = (services, callback) => services[0] === 'configForms' ? callback(fixture.ctx) : originalInject(services, callback)
  try {
    apply(fixture.ctx)
    assert.deepEqual(ids, ['better-tasks-ui'])
    assert.deepEqual(writes, [])
    snapshot = { status: 'ready', writable: true, value: DEFAULT_TASK_PREFERENCES }
    for (const fn of listeners) fn()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(writes, [['sidebarView', 'tasks']])
    assert.equal(values.has('dsh-better-tasks.view'), false)
    const sidebar = fixture.registrations.find(x => x.options.name === 'sidebar').options.inject()
    await sidebar.setTaskPreference('sidebarView', 'native')
    assert.equal(sidebar.hooks.taskPreferences.getSnapshot().value.sidebarView, 'native')
    assert.deepEqual(writes.at(-1), ['sidebarView', 'native'])
  } finally { globalThis.localStorage = previousStorage }
})

test('keeps registration side effects tied to Cordis lifecycle helpers', () => {
  const fixture = createContext()
  apply(fixture.ctx)
  assert.ok(fixture.effects.length >= 2)
  assert.ok(fixture.subscriptions.some(([name]) => name === 'sidebar.panellist'))
  assert.ok(fixture.subscriptions.some(([name]) => name === 'locale'))
})
