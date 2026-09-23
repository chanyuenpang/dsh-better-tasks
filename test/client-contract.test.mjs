import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, BetterSidebarRoot } from '../src/client.js'

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
      if (services.length === 1 && services[0] === 'settingsScope') return () => {}
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

  assert.deepEqual(fixture.injections, ['sidebar'])
  assert.equal(fixture.registrations.length, 1)
  const [{ options, component }] = fixture.registrations
  assert.equal(options.name, 'sidebar')
  assert.equal(options.priority, undefined)
  assert.equal(options.locale, 'better-tasks-sidebar')
  assert.equal(component, BetterSidebarRoot)
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

test('keeps registration side effects tied to Cordis lifecycle helpers', () => {
  const fixture = createContext()
  apply(fixture.ctx)
  assert.ok(fixture.effects.length >= 2)
  assert.ok(fixture.subscriptions.some(([name]) => name === 'sidebar.panellist'))
  assert.ok(fixture.subscriptions.some(([name]) => name === 'locale'))
})
