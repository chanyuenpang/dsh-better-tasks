import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Actual view handlers in an in-memory hook/JSX host. No browser, build or layout.
const ts = createRequire(new URL('../.srcbuild/package.json', import.meta.url))('typescript')
const base = '../.srcbuild/packages/client/ui-conversation/src/client/input/'
const source = readFileSync(new URL(base + 'InputSurfaceView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL(base + 'InputSurfaceView.module.css', import.meta.url), 'utf8')
const original = readFileSync(new URL('../releases/0.2.8-desktop-selection/better-tasks/package/src/client.js', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { fileName: 'InputSurfaceView.tsx', compilerOptions: {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
const element = (type, props) => ({ type, props })
const store = initial => { let value = initial; return { subscribe: () => () => {}, getSnapshot: () => value, set(next) { value = next } } }
function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate))
  if (!node || typeof node !== 'object') return []
  return [...predicate(node) ? [node] : [], ...all(node.props?.children, predicate)]
}
function fixture(options = {}) {
  const calls = [], refs = [], states = [], effects = [], nodes = new Map()
  let r = 0, s = 0, e = 0, scheduled = [], dirty = false, now = 100, tree, keymap, available = true, viewDisabled = false, editorComposing = false
  const body = { name: 'body' }, outside = { name: 'outside' }, document = { body, activeElement: body }
  const state = store({ draft: '前文 后文', draftRev: 3, phase: 'plain', claim: undefined })
  const notices = store(null), gate = store({ disabled: false, running: false })
  const menu = store({ open: false, highlight: null, groups: [] }), launcher = store(null), popupState = store({ open: false })
  const selection = { start: 2, end: 3 }
  let pickImpl = () => {}, arbitrateImpl = () => 'pass'
  const closeMenu = () => { menu.set({ ...menu.getSnapshot(), open: false }); launcher.set(null) }
  const shell = {
    state, notices, get snapshot() { return state.getSnapshot() }, editor: { isComposing: () => editorComposing },
    caretSpan: () => selection, setDraft: value => { calls.push(['setDraft', value]); state.set({ ...state.getSnapshot(), draft: value, draftRev: state.getSnapshot().draftRev + 1 }) },
    focus: () => { calls.push(['focus']); document.activeElement = { name: 'editor' } },
    arbitrate: (key, composing) => { calls.push(['arbitrate', key, composing]); return arbitrateImpl(key) },
    space: () => false, dismissPopup: () => calls.push(['dismissPopup']), notify: (...args) => calls.push(['notify', ...args]),
    paste: text => calls.push(['paste', text]),
  }
  const surface = { shell, id: 'card-one', gate,
    trigger: { menu, launcher, headers: store(new Map()), View: 'MenuView',
      pick: (...args) => { calls.push(['pick', ...args]); pickImpl(...args) },
      pickCrumb: (...args) => calls.push(['crumb', ...args]), hover: (...args) => calls.push(['hover', ...args]),
      dismiss: () => { calls.push(['dismiss']); closeMenu() },
    },
    command: { popup: { state: popupState }, View: 'PopupView' },
    menuTranslate: key => key, commandTranslate: key => key, translate: key => key,
    canInteract: () => available && !viewDisabled,
    setDisabled: value => { viewDisabled = value },
    submit: (...args) => calls.push(['submit', ...args]),
    launchMenu: () => { calls.push(['launch']); menu.set({ open: true, highlight: null, groups: [] }); launcher.set('all') },
    filterMenu: query => calls.push(['filter', query]),
  }
  const react = {
    useRef(value) { const id = r++; return refs[id] ??= { current: value } },
    useState(initial) {
      const id = s++; if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial
      return [states[id], next => { const value = typeof next === 'function' ? next(states[id]) : next; if (!Object.is(value, states[id])) { states[id] = value; dirty = true } }]
    },
    useSyncExternalStore: (_, get) => get(),
    useEffect(fn, deps) {
      const id = e++, prev = effects[id]
      if (!prev || deps.some((value, index) => !Object.is(value, prev.deps[index]))) scheduled.push(() => {
        prev?.off?.(); effects[id] = { deps, off: fn() }
      })
    },
  }
  react.useLayoutEffect = react.useEffect
  const classes = new Proxy({}, { get: (_, key) => String(key) })
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    '@deepseek-ai/dsh-client-ui-primitives': { Tooltip: 'Tooltip', IconPlusOutline16: 'IconPlusOutline16' },
    './editor/DraftEditor.tsx': { DraftEditor: 'DraftEditor' },
    './editor/keymap.ts': { registerComposerKeymap: (_, handlers) => { keymap = handlers; return () => {} } },
    './InputSurfaceView.module.css': { default: classes },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', 'document', 'Date', compiled)(module, module.exports,
    name => { assert.ok(name in dependencies, `unexpected dependency ${name}`); return dependencies[name] }, document, { now: () => now })
  const props = { surface, placeholder: '继续', defaultText: '继续', submitLabel: '发送', addLabel: '添加',
    searchLabel: '搜索技能和指令', inputLabel: '继续', ...options }
  function attach(node, path = 'root') {
    if (Array.isArray(node)) return node.forEach((child, index) => attach(child, `${path}.${index}`))
    if (!node || typeof node !== 'object') return
    let dom = nodes.get(path)
    if (!dom) { dom = { path, contains: other => other?.path === path || other?.path?.startsWith(path + '.'),
      focus: () => { calls.push(['domFocus', node.type]); document.activeElement = dom } }; nodes.set(path, dom) }
    if (node.props?.ref) node.props.ref.current = dom
    attach(node.props?.children, path + '.children')
  }
  function render() {
    let runs = 0
    do {
      assert.ok(++runs < 12, 'hook update loop')
      dirty = false; r = 0; s = 0; e = 0; scheduled = []
      tree = module.exports.InputSurfaceView(props); attach(tree)
      for (const run of scheduled) run()
    } while (dirty)
  }
  render()
  const nodesOf = predicate => all(tree, predicate)
  const one = predicate => { const found = nodesOf(predicate); assert.equal(found.length, 1); return found[0] }
  return { calls, state, notices, gate, menu, launcher, popupState, surface, props, render, selection, closeMenu,
    nodes: nodesOf, one, tree: () => tree, keymap: () => keymap,
    plus: () => one(n => n.type === 'button' && n.props.className === 'add'),
    send: () => one(n => n.type === 'button' && n.props.className === 'send'),
    search: () => one(n => n.type === 'input' && n.props.className === 'search'),
    menuView: () => one(n => n.type === 'MenuView'),
    userEdit: () => one(n => typeof n.props?.onBeforeInputCapture === 'function').props.onBeforeInputCapture(),
    open() { this.plus().props.onClick(); render() },
    setTime(value) { now = value }, setComposing(value) { editorComposing = value }, setAvailable(value) { available = value },
    setPick(fn) { pickImpl = fn }, setArbitrate(fn) { arbitrateImpl = fn },
    focusOutside() { document.activeElement = outside }, focusBody() { document.activeElement = body },
    key(key, extra = {}) {
      let prevented = 0, stopped = 0
      const { nativeEvent, ...rest } = extra
      this.search().props.onKeyDown({ key, keyCode: 0, repeat: false, shiftKey: false,
        nativeEvent: { isComposing: false, ...nativeEvent }, preventDefault: () => { prevented++ }, stopPropagation: () => { stopped++ }, ...rest })
      return { prevented, stopped }
    },
    visibleNotice: () => nodesOf(n => n.props?.className === 'notice').map(n => n.props.children),
  }
}

test('original compact chrome uses one plus and one icon send with 500ms tooltips and editor-first order', () => {
  const f = fixture()
  assert.equal(f.nodes(n => n.type === 'button').length, 2)
  const plus = f.plus(), send = f.send()
  assert.equal(plus.props['aria-haspopup'], 'dialog'); assert.equal(plus.props['aria-expanded'], false)
  assert.equal(plus.props['aria-label'], '添加'); assert.equal(send.props['aria-label'], '发送')
  const tips = f.nodes(n => n.type === 'Tooltip')
  assert.deepEqual(tips.map(n => [n.props.side, n.props.delayMs]), [['top', 500], ['top', 500]])
  const glyph = all(plus, n => n.type === 'svg' || n.type === 'IconPlusOutline16')[0]
  assert.ok(glyph); assert.equal(Number(glyph.props.width ?? glyph.props.size), 14)
  const path = all(send, n => n.type === 'path')[0].props.d
  assert.equal(path, original.match(/d: '(M8\.3125[^']+)'/)[1])
  const children = f.one(n => n.props?.['data-composer-card'] !== undefined).props.children
  assert.equal(children[0].props.children.type, 'DraftEditor')
  assert.equal(children[1].props.className, 'picker'); assert.equal(children.at(-1).props.className, 'actions')
})

test('combined search query changes no draft, revision or captured selection and resets on reopen', () => {
  const f = fixture(), before = f.state.getSnapshot(), selection = { ...f.selection }
  f.open(); f.search().props.onChange({ target: { value: 'skill name' } }); f.render()
  assert.equal(f.search().props.value, 'skill name')
  assert.strictEqual(f.state.getSnapshot(), before); assert.deepEqual(f.selection, selection)
  assert.ok(f.calls.some(c => c[0] === 'filter' && c[1] === 'skill name'))
  assert.ok(!f.calls.some(c => c[0] === 'submit' || c[0] === 'setDraft'))
  f.plus().props.onClick(); f.render(); f.open()
  assert.equal(f.search().props.value, '')
})

test('search Enter with no highlight never submits and repeated Enter does not arbitrate', () => {
  const f = fixture(); f.open(); f.calls.length = 0
  assert.deepEqual(f.key('Enter'), { prevented: 1, stopped: 1 })
  assert.deepEqual(f.calls, [['arbitrate', 'enter', false]])
  f.calls.length = 0
  assert.deepEqual(f.key('Enter', { repeat: true }), { prevented: 1, stopped: 1 })
  assert.deepEqual(f.calls, [])
})

test('empty forward Tab exits without trapping focus while ShiftTab returns to the editor', () => {
  const f = fixture(); f.open(); f.calls.length = 0
  assert.deepEqual(f.key('Tab'), { prevented: 0, stopped: 1 })
  assert.deepEqual(f.calls, [['arbitrate', 'tab', false], ['dismiss']])
  f.render(); f.open(); f.calls.length = 0
  f.setArbitrate(key => { if (key === 'tabBack') { f.closeMenu(); return 'consumed' } return 'pass' })
  assert.deepEqual(f.key('Tab', { shiftKey: true }), { prevented: 1, stopped: 1 })
  assert.deepEqual(f.calls, [['arbitrate', 'tabBack', false], ['focus']])
})

test('search composition, legacy229 and post-composition Enter cannot select or submit', () => {
  const f = fixture(); f.open(); f.calls.length = 0
  for (const extra of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
    for (const key of ['Enter', 'ArrowDown', 'Escape']) assert.deepEqual(f.key(key, extra), { prevented: 0, stopped: 0 })
  }
  f.search().props.onCompositionStart()
  assert.deepEqual(f.key('Enter'), { prevented: 0, stopped: 0 })
  f.search().props.onCompositionEnd()
  f.setTime(109); assert.deepEqual(f.key('Enter'), { prevented: 0, stopped: 0 })
  assert.deepEqual(f.calls, [])
  f.setTime(110); assert.deepEqual(f.key('ArrowDown'), { prevented: 1, stopped: 1 })
  assert.deepEqual(f.calls, [['arbitrate', 'down', false]])
})

test('popup handoff and external dismissal do not steal editor focus', () => {
  const f = fixture(); f.open(); f.calls.length = 0
  f.setPick(() => { f.closeMenu(); f.popupState.set({ open: true }) })
  f.menuView().props.onPick('command', 0); f.render()
  assert.ok(!f.calls.some(c => c[0] === 'focus'))
  f.popupState.set({ open: false }); f.open(); f.calls.length = 0; f.focusOutside()
  f.menuView().props.onDismiss(); f.render()
  assert.ok(!f.calls.some(c => c[0] === 'focus'))
})

test('skill insertion returns focus but intentionally opened external dialog keeps it', () => {
  const f = fixture(); f.open(); f.calls.length = 0
  f.setPick(() => { f.state.set({ ...f.state.getSnapshot(), draftRev: 4, draft: '/skill ' }); f.closeMenu() })
  f.menuView().props.onPick('skill', 0)
  assert.equal(f.calls.filter(c => c[0] === 'focus').length, 1)
  f.render(); f.open(); f.calls.length = 0
  f.setPick(() => { f.closeMenu(); f.focusOutside() })
  f.menuView().props.onPick('command', 0)
  assert.ok(!f.calls.some(c => c[0] === 'focus'))
})

test('Escape consumes propagation and explicitly returns the editor focus', () => {
  const f = fixture(); f.open(); f.calls.length = 0
  assert.deepEqual(f.key('Escape'), { prevented: 1, stopped: 1 })
  assert.deepEqual(f.calls, [['dismiss'], ['focus']])
})

test('user edit dismisses only its captured notice; search and programmatic restoration do not', () => {
  const f = fixture()
  f.notices.set({ seq: 1, level: 'error', text: 'old error' }); f.render()
  f.open(); f.search().props.onChange({ target: { value: 'query' } }); f.render()
  assert.deepEqual(f.visibleNotice(), ['old error'])
  const edit = f.one(n => typeof n.props?.onBeforeInputCapture === 'function').props.onBeforeInputCapture
  f.notices.set({ seq: 2, level: 'error', text: 'new error' }); edit(); f.render()
  assert.deepEqual(f.visibleNotice(), ['new error'])
  f.userEdit(); f.render(); assert.deepEqual(f.visibleNotice(), [])
  f.state.set({ ...f.state.getSnapshot(), draft: 'late restored', draftRev: 9 })
  f.notices.set({ seq: 3, level: 'error', text: 'late failure' }); f.render()
  assert.deepEqual(f.visibleNotice(), ['late failure'])
  assert.ok(f.tree().props.children.slice(1).some(n => n?.props?.className === 'notice'), 'error is outside rounded surface')
})

test('explicit send and successful pick dismiss old notice without hiding a newer async notice', () => {
  for (const gesture of ['send', 'pick']) {
    const f = fixture()
    f.notices.set({ seq: 1, level: 'error', text: 'old' }); f.render()
    if (gesture === 'pick') f.open()
    const act = gesture === 'send' ? f.send().props.onClick : () => f.menuView().props.onPick('skill', 0)
    f.setPick(() => { f.state.set({ ...f.state.getSnapshot(), draftRev: 4 }); f.closeMenu() })
    f.notices.set({ seq: 2, level: 'error', text: 'new' }); act(); f.render()
    assert.deepEqual(f.visibleNotice(), ['new'])
  }
})

test('successful explicit send and skill pick clear the currently visible old error', () => {
  for (const gesture of ['send', 'pick']) {
    const f = fixture()
    f.notices.set({ seq: 1, level: 'error', text: 'old' }); f.render()
    if (gesture === 'send') f.send().props.onClick()
    else {
      f.open(); f.setPick(() => { f.state.set({ ...f.state.getSnapshot(), draftRev: 4 }); f.closeMenu() })
      f.menuView().props.onPick('skill', 0)
    }
    f.render(); assert.deepEqual(f.visibleNotice(), [], gesture)
  }
})

test('combined pending, empty and failed statuses do not disable a healthy source', () => {
  const f = fixture({ emptyLabel: 'No matches', errorLabel: 'Catalog unavailable' }); f.open()
  f.menu.set({ open: true, highlight: null, groups: [
    { source: 'skill', status: 'ready', items: [] }, { source: 'command', status: 'pending', items: [] },
  ] }); f.render()
  assert.equal(f.nodes(n => n.props?.className === 'status').length, 0, 'pending is not empty')
  f.menu.set({ ...f.menu.getSnapshot(), groups: [
    { source: 'skill', status: 'ready', items: [] }, { source: 'command', status: 'ready', items: [] },
  ] }); f.render()
  assert.equal(f.one(n => n.props?.className === 'status').props.children, 'No matches')
  f.menu.set({ ...f.menu.getSnapshot(), groups: [
    { source: 'skill', status: 'ready', items: [{ name: 'available' }] }, { source: 'command', status: 'ready', failed: true, items: [] },
  ] }); f.render()
  assert.equal(f.one(n => n.props?.className === 'status' && n.props.role === 'alert').props.children, 'Catalog unavailable')
  f.menuView().props.onPick('skill', 0)
  assert.ok(f.calls.some(c => c[0] === 'pick' && c[1] === 'skill'))
})

test('empty default Continue stays enabled, while busy/disabled/unavailable/composing gestures are gated', () => {
  const f = fixture(); f.state.set({ ...f.state.getSnapshot(), draft: '' }); f.render()
  assert.equal(f.send().props.disabled, false); f.send().props.onClick()
  assert.ok(f.calls.some(c => c[0] === 'submit' && c[1] === '继续'))
  const draft = f.one(n => n.type === 'DraftEditor')
  assert.equal(draft.props.showPlaceholder, true); assert.equal(draft.props.ariaLabel, '继续')
  f.state.set({ ...f.state.getSnapshot(), draft: ' ' }); f.render()
  assert.equal(f.one(n => n.type === 'DraftEditor').props.showPlaceholder, false)
  for (const blocked of ['busy', 'disabled', 'unavailable', 'composition']) {
    const b = fixture()
    if (blocked === 'busy') b.state.set({ ...b.state.getSnapshot(), phase: 'submitting' })
    if (blocked === 'disabled') b.props.disabled = true
    if (blocked === 'unavailable') b.setAvailable(false)
    if (blocked === 'composition') b.setComposing(true)
    b.render(); b.calls.length = 0; b.plus().props.onClick(); b.send().props.onClick()
    assert.ok(!b.calls.some(c => c[0] === 'submit' || c[0] === 'launch'), blocked)
  }
})

test('keymap uses current defaults and clears captured notice only on explicit send or paste', () => {
  const f = fixture()
  f.props.defaultText = 'Continue'; f.notices.set({ seq: 5, level: 'error', text: 'old' }); f.render()
  f.keymap().submit(false); f.render()
  assert.ok(f.calls.some(c => c[0] === 'submit' && c[1] === 'Continue'))
  assert.deepEqual(f.visibleNotice(), [])
  f.notices.set({ seq: 6, level: 'error', text: 'another' }); f.render()
  f.keymap().pasteText('pasted'); f.render()
  assert.ok(f.calls.some(c => c[0] === 'paste' && c[1] === 'pasted')); assert.deepEqual(f.visibleNotice(), [])
})

test('native command ghost hint appears only for claimed/submitting commands without arguments', () => {
  const f = fixture(), claim = { token: '/goal ', hint: 'Enter objective' }
  const hint = () => f.one(n => n.type === 'DraftEditor').props.hint
  for (const phase of ['claimed', 'submitting']) {
    f.state.set({ ...f.state.getSnapshot(), phase, claim, draft: '/goal ' }); f.render()
    assert.equal(hint(), 'Enter objective')
    f.state.set({ ...f.state.getSnapshot(), draft: '/goal   ' }); f.render()
    assert.equal(hint(), 'Enter objective')
    f.state.set({ ...f.state.getSnapshot(), draft: '/goal user argument' }); f.render()
    assert.equal(hint(), null)
  }
  f.state.set({ ...f.state.getSnapshot(), phase: 'plain', draft: '/goal ' }); f.render()
  assert.equal(hint(), null)
  assert.match(css, /\.input p:last-child::after\s*\{[^}]*content:\s*var\(--dsh-composer-hint\)/)
  assert.match(css, /\.input\[data-composer-composing\] p:last-child::after\s*\{\s*content:\s*none/)
})

test('restored stylesheet keeps original static dimensions and placeholder focus selectors', () => {
  for (const pattern of [/max-height:\s*120px/, /min-height:\s*32px/, /padding:\s*7px 11px 5px/, /line-height:\s*18px/,
    /min-height:\s*36px/, /padding:\s*1px 6px 6px/, /width:\s*27px/, /height:\s*27px/, /width:\s*28px/, /height:\s*28px/,
    /height:\s*29px/, /max-height:\s*180px/, /\.input:focus\s*\+\s*\.placeholder/, /data-composer-composing/]) assert.match(css, pattern)
  assert.doesNotMatch(source, /getBoundingClientRect|getComputedStyle|scrollHeight|offsetHeight/)
})
