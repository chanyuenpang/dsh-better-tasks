import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { SESSION_REFERENCE_MIME, readSessionReferenceDrag } from '../src/session-reference-drag.mjs'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const factoryReturn = 'return { name, inject, apply, contract }'
function load(extra, globals = {}) {
  assert.equal(bundle.split(factoryReturn).length, 2)
  let descriptor
  vm.runInNewContext(bundle.replace(factoryReturn, `return { name, inject, apply, contract, ${extra} }`), {
    window: { __ModuleLoader__: { load(value) { descriptor = value } }, setTimeout: fn => fn() },
    TextEncoder, ...globals,
  }, { filename: 'lib/client.js' })
  return descriptor.factory(() => { throw Error('drag transport must not need an external module') })
}

class Transfer {
  data = new Map()
  effectAllowed = 'none'
  dropEffect = 'none'
  get types() { return [...this.data.keys()] }
  setData(type, value) { this.data.set(type, value) }
  getData(type) { return this.data.get(type) ?? '' }
}

// Use the shipped handlers AND their real factory dependency scope. Source-only
// tests used to pass although the installed bundle omitted the transport module.
const view = bundle.slice(bundle.indexOf('function TaskSwimlane('), bundle.indexOf('function SidebarRegion('))
const guards = view.slice(view.indexOf('const canCommitTaskDrop ='), view.indexOf("return element('section'"))
const handlers = view.slice(view.indexOf('onPointerDownCapture:'), view.indexOf("element('div', { className: 'dbt-task-title-row'"))
  .replace(/\s*\},\s*$/, '')
assert.ok(guards && handlers.includes('onDragStart:') && handlers.includes('onDrop:'))
const { makeHandlers } = load(`makeHandlers: (state) => {
  const { task, taskIds, taskPins, pendingMoves, drag, dragOriginGuard, dragClickGuard,
    setDrag, moveTaskBefore, setMoveError, twoColumns, openSession, cardFinalRequests } = state
  ${guards}
  return { ${handlers} }
}`)
function fixture({ id = 'source', writable = true, pending = [], drag = null, ids = ['source', 'target'] } = {}) {
  const changes = [], moves = [], opened = []
  const state = {
    task: { id }, taskIds: ids, taskPins: { writable }, pendingMoves: new Set(pending), drag,
    dragOriginGuard: { current: null }, dragClickGuard: { current: null },
    setDrag: value => changes.push(value), moveTaskBefore: (...args) => { moves.push(args); return Promise.resolve() },
    setMoveError() {}, twoColumns: false, openSession: id => opened.push(id), cardFinalRequests: { current: null },
  }
  return { state, changes, moves, opened, handlers: makeHandlers(state) }
}
function event(transfer = new Transfer(), blocked = false) {
  return {
    dataTransfer: transfer, defaultPrevented: false, stopped: false, detail: 1, clientY: 9,
    target: { closest: () => blocked ? {} : null },
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 10 }) },
    preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true },
  }
}

test('every named client import is linked inside the generated module factory', () => {
  const imports = [...source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm)]
    .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean))
  assert.ok(imports.includes('writeSessionReferenceDrag'))
  const plugin = load(`linked: { ${imports.join(', ')} }`)
  for (const name of imports) assert.notEqual(plugin.linked[name], undefined, name)
})

test('shipped card dragstart publishes both move and native-reference capabilities without cancelling', () => {
  const f = fixture(), e = event()
  f.handlers.onPointerDownCapture(e)
  f.handlers.onDragStart(e)
  assert.equal(e.defaultPrevented, false)
  assert.equal(e.dataTransfer.effectAllowed, 'copyMove')
  assert.deepEqual(readSessionReferenceDrag(e.dataTransfer), { version: 1, sessionId: 'source' })
  assert.equal(e.dataTransfer.getData('text/plain'), 'source')
  assert.deepEqual(JSON.parse(JSON.stringify(f.changes)), [{ sessionId: 'source', overId: 'source', half: 'before' }])
  assert.equal(f.state.dragClickGuard.current, 'source')
  f.handlers.onClick(e)
  assert.deepEqual(f.opened, [])
})

test('read-only or pending cards can reference but cannot start a reorder', () => {
  for (const options of [{ writable: false }, { pending: ['source'] }]) {
    const f = fixture(options), e = event()
    f.handlers.onDragStart(e)
    assert.equal(e.defaultPrevented, false)
    assert.equal(e.dataTransfer.effectAllowed, 'copy')
    assert.equal(readSessionReferenceDrag(e.dataTransfer).sessionId, 'source')
    assert.deepEqual(f.changes, [null])
  }
})

test('nested controls and the recorded pointer origin still refuse whole-card drag', () => {
  for (const originOnly of [false, true]) {
    const f = fixture(), e = event(undefined, true)
    f.handlers.onPointerDownCapture(e)
    if (originOnly) e.target = { closest: () => null }
    f.handlers.onDragStart(e)
    assert.equal(e.defaultPrevented, true)
    assert.equal(e.dataTransfer.types.length, 0)
    assert.deepEqual(f.changes, [])
  }
})

test('valid actual card drop reorders once, while copy, cancellation and foreign payloads never do', () => {
  const start = fixture(), e = event()
  start.handlers.onDragStart(e)
  const active = start.changes[0]
  const target = fixture({ id: 'target', drag: { ...active, overId: 'target', half: 'after' } })
  target.handlers.onDrop(e)
  assert.equal(e.defaultPrevented, true)
  assert.deepEqual(target.moves, [['source', null]])
  // Hover followed by composer copy or Escape ends without committing a move.
  const cancelled = fixture({ drag: active })
  cancelled.handlers.onDragOver(event(e.dataTransfer))
  cancelled.handlers.onDragEnd()
  assert.deepEqual(cancelled.moves, [])
  assert.equal(cancelled.changes.at(-1), null)
  assert.equal(cancelled.state.dragClickGuard.current, null)
  for (const options of [{}, { drag: active, writable: false }, { drag: active, pending: ['source'] }, { drag: active, ids: ['target'] }]) {
    const f = fixture(options)
    f.handlers.onDrop(event(e.dataTransfer))
    assert.deepEqual(f.moves, [])
  }
  const foreign = new Transfer()
  foreign.setData(SESSION_REFERENCE_MIME, JSON.stringify({ version: 1, sessionId: 'foreign' }))
  cancelled.handlers.onDrop(event(foreign))
  assert.deepEqual(cancelled.moves, [])
})
