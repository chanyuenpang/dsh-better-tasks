import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Execute the actual TSX event handlers with a hook/JSX host, not a browser.
// No runtime, bundling, geometry, screenshot or business-service activity.
const ts = createRequire(new URL('../.srcbuild/package.json', import.meta.url))('typescript')
const file = new URL('../.srcbuild/packages/client/ui-commands/src/client/PopupSelectView.tsx', import.meta.url)
const source = readFileSync(file, 'utf8')
const compiled = ts.transpileModule(source, { fileName: 'PopupSelectView.tsx', compilerOptions: {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
const tree = (type, props) => ({ type, props })
function find(node, predicate) {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found } }
  else if (node && typeof node === 'object') {
    if (predicate(node)) return node
    return find(node.props?.children, predicate)
  }
}
function fixture() {
  const calls = [], refs = [], effects = []
  let refIndex = 0, effectIndex = 0, scheduled = [], now = 100, current
  const state = { open: true, command: 'model', status: 'ready', options: [{ id: 'one', label: 'One' }],
    active: 0, search: '', searchMode: 'filter', searchLabels: null, error: null,
    confirming: null, submitting: false, acknowledged: false }
  const popup = {
    state: { subscribe: () => () => {}, getSnapshot: () => state },
    move: dir => calls.push(['move', dir]), select: index => { calls.push(['select', index]); return Promise.resolve() },
    dismiss: options => calls.push(['dismiss', options]), setSearch: value => calls.push(['search', value]),
    highlight() {}, retry() {},
  }
  const react = { Fragment: 'fragment', useMemo: fn => fn(), useSyncExternalStore: (_, get) => get(),
    useRef(value) { const id = refIndex++; return refs[id] ??= { current: value } },
    useEffect(fn, deps) {
      const id = effectIndex++, previous = effects[id]
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        scheduled.push(() => { previous?.off?.(); effects[id] = { deps, off: fn() } })
      }
    },
  }
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: tree, jsxs: tree, Fragment: 'fragment' },
    '@deepseek-ai/dsh-client-ui-primitives': { MenuGroup: 'MenuGroup', MenuSurface: 'MenuSurface', RiskConfirmation: 'RiskConfirmation',
      IconCheckOutlineRegular: 'Icon', observeStickyMenuGroups: () => () => {}, useAnchoredMaxHeight: () => 320 },
    clsx: { default: (...values) => values.filter(Boolean).join(' ') },
    './popup.ts': { filterOptions: options => options },
    './option-groups.ts': { groupOptions: rows => [{ group: undefined, rows }] },
    './PopupSelectView.module.css': { default: {} },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', 'Date', 'document', compiled)(module, module.exports,
    name => { assert.ok(name in dependencies, `unexpected import ${name}`); return dependencies[name] },
    { now: () => now }, { addEventListener() {}, removeEventListener() {} })
  const render = () => {
    refIndex = 0; effectIndex = 0; scheduled = []
    current = module.exports.PopupSelectView({ popup, t: key => key, inline: true })
    for (const run of scheduled) run()
  }
  render()
  return { calls, state, render, setTime: value => { now = value },
    input: () => find(current, node => node.type === 'input').props,
    key(key, native = {}) {
      let prevented = 0
      find(current, node => node.type === 'MenuSurface').props.onKeyDown({ key, nativeEvent: { isComposing: false, keyCode: 0, ...native },
        shiftKey: false, repeat: native.repeat === true, preventDefault: () => { prevented++ } })
      return prevented
    },
  }
}

test('parameter popup leaves IME Enter, arrows, Escape and Tab to the browser', () => {
  for (const native of [{ isComposing: true }, { keyCode: 229 }]) {
    const f = fixture()
    for (const key of ['Enter', 'ArrowUp', 'ArrowDown', 'Escape', 'Tab']) assert.equal(f.key(key, native), 0)
    assert.deepEqual(f.calls, [])
  }
})
test('composition events protect popup keys even if the keydown flag is missing', () => {
  const f = fixture()
  f.input().onCompositionStart()
  for (const key of ['Enter', 'ArrowUp', 'ArrowDown', 'Escape']) assert.equal(f.key(key), 0)
  assert.deepEqual(f.calls, [])
  f.input().onChange({ currentTarget: { value: '模型' } })
  assert.deepEqual(f.calls, [['search', '模型']], 'filtering itself must remain usable while composing')
})
test('compositionend closing Enter is ignored, then ordinary parameter selection resumes', () => {
  const f = fixture()
  f.input().onCompositionStart(); f.input().onCompositionEnd()
  assert.equal(f.key('Enter'), 0)
  f.setTime(109); assert.equal(f.key('Enter'), 0); assert.equal(f.key('Escape'), 0)
  assert.deepEqual(f.calls, [])
  f.setTime(110); assert.equal(f.key('Enter'), 1)
  assert.equal(f.key('ArrowDown'), 1); assert.equal(f.key('Escape'), 1)
  assert.deepEqual(f.calls, [['select', 0], ['move', 1], ['dismiss', { focusComposer: true }]])
})
test('closing an unfinished composition does not poison a later popup', () => {
  const f = fixture()
  f.input().onCompositionStart()
  f.state.open = false; f.render()
  f.state.open = true; f.render()
  assert.equal(f.key('Enter'), 1)
  assert.deepEqual(f.calls, [['select', 0]])
})
test('switching the popup command clears abandoned composition state', () => {
  const f = fixture()
  f.input().onCompositionStart()
  f.state.command = 'permission'; f.render()
  assert.equal(f.key('ArrowUp'), 1)
  assert.deepEqual(f.calls, [['move', -1]])
})
test('held Enter is consumed without selecting but repeated arrows still navigate', () => {
  const f = fixture()
  assert.equal(f.key('Enter', { repeat: true }), 1)
  assert.deepEqual(f.calls, [], 'menu-opening Enter must not auto-select a popup parameter')
  assert.equal(f.key('ArrowDown', { repeat: true }), 1)
  assert.equal(f.key('ArrowUp', { repeat: true }), 1)
  assert.equal(f.key('Enter'), 1)
  assert.deepEqual(f.calls, [['move', 1], ['move', -1], ['select', 0]])
})
test('IME repeat Enter remains owned by the browser instead of being swallowed', () => {
  const f = fixture()
  assert.equal(f.key('Enter', { repeat: true, isComposing: true }), 0)
  assert.deepEqual(f.calls, [])
})
test('popup view declaration stays explicitly typed after IME protection', () => {
  const emitted = ts.transpileDeclaration(source, { fileName: 'PopupSelectView.tsx', compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } })
  assert.deepEqual((emitted.diagnostics ?? []).filter(row => row.category === ts.DiagnosticCategory.Error), [])
})
