import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { DEFAULT_TASK_PREFERENCES } from '../src/task-preferences.mjs'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const rootSource = source.slice(source.indexOf('export function BetterSidebarRoot('), source.indexOf('function TaskSettingsSection(')).replace(/^export /gm, '')
const leadingSource = source.slice(source.indexOf('export function SidebarReopenControls('), source.indexOf('export function BetterSidebarRoot(')).replace(/^export /gm, '')
const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() })
const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes), ...nodes(node.props.children)] : []

function fixture({ windows = false, collapsed = true, settled = collapsed, noDocument = false } = {}) {
  const calls = [], effects = [], slots = []
  const context = {
    element,
    requireModule: name => name === 'react' ? {
      createElement: element,
      useState: () => [settled, () => {}],
      useEffect: effect => effects.push(effect),
      useRef: value => ({ current: value }),
    } : { Tooltip: 'Tooltip', IconPanelLeftOutlineRegular: 'PanelIcon', IconNewChatOutlineRegular: 'NewIcon' },
    IconPanelLeftOutlineRegular: 'PanelIcon', PanelRow: 'PanelRow', SidebarRegion: 'SidebarRegion',
    TASK_GRID_TWO_COLUMN_THRESHOLD: 528,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
  }
  if (!noDocument) context.document = { documentElement: { hasAttribute: attr => attr === 'data-windows-titlebar' && windows } }
  const props = {
    collapsed, width: collapsed ? 0 : 280,
    startSession: (...args) => calls.push(['new', ...args]),
    toggleSidebar: () => calls.push(['toggle']),
    usePanels: select => select([]),
    useTaskPreferences: select => select({ value: DEFAULT_TASK_PREFERENCES }),
    t: key => key,
    renderSlot: name => { slots.push(name); return null },
  }
  const Root = vm.runInNewContext(`${rootSource}\nBetterSidebarRoot`, context)
  return { tree: Root(props), calls, slots, context, props }
}

for (const settled of [false, true]) {
  test(`Windows zero-width collapse keeps its native-action caption button through settle=${settled}`, () => {
    const f = fixture({ windows: true, collapsed: true, settled })
    assert.equal(f.tree.props['data-wide'], 'false')
    const all = nodes(f.tree)
    const button = all.find(x => x.props.className === 'dbt-icon-button dbt-toggle')
    assert.equal(button.type, 'button')
    assert.equal(button.props['aria-label'], 'toggle.open')
    assert.equal(button.props['aria-expanded'], false)
    button.props.onClick({ detail: 0 }) // Native keyboard/synthetic activation is not filtered.
    assert.deepEqual(f.calls, [['toggle']])
    const icon = nodes(button).find(x => x.type === 'PanelIcon')
    assert.equal(icon.props.size, 16)
    assert.equal(nodes(button).some(x => x.props.className === 'dbt-rail-mark'), false)
    const tooltip = all.find(x => x.type === 'Tooltip' && x.props.label === 'toggle.open')
    assert.equal(tooltip.props.side, 'bottom')
    assert.equal(tooltip.props.portal, true)
    const newButton = all.find(x => x.props.className === 'dbt-new-session')
    newButton.props.onClick()
    assert.deepEqual(f.calls.at(-1), ['new'])
  })
}

test('Windows expanded toggle keeps the same native collapse action and accessibility state', () => {
  const f = fixture({ windows: true, collapsed: false })
  const button = nodes(f.tree).find(x => x.props.className === 'dbt-icon-button dbt-toggle')
  assert.equal(f.tree.props['data-wide'], 'true')
  assert.equal(button.props['aria-label'], 'toggle.collapse')
  assert.equal(button.props['aria-expanded'], true)
  button.props.onClick()
  assert.deepEqual(f.calls, [['toggle']])
})

test('browser/legacy collapsed rail and its existing hover-mark contract remain unchanged', () => {
  const f = fixture({ windows: false, collapsed: true })
  assert.equal(f.tree.props['data-wide'], 'false')
  const button = nodes(f.tree).find(x => x.props.className === 'dbt-icon-button dbt-toggle')
  assert.equal(nodes(button).some(x => x.props.className === 'dbt-rail-mark'), true)
  assert.equal(nodes(button).find(x => x.type === 'PanelIcon').props.size, 18)
  const tooltip = nodes(f.tree).find(x => x.type === 'Tooltip' && x.props.label === 'toggle.open')
  assert.equal(tooltip.props.side, 'right')
  assert.equal(tooltip.props.portal, false)
  button.props.onClick()
  assert.deepEqual(f.calls, [['toggle']])
  const fading = fixture({ windows: false, collapsed: true, settled: false })
  assert.equal(fading.tree.props['data-wide'], 'true')
})

test('environment without document keeps safe browser-mode rendering', () => {
  const f = fixture({ noDocument: true, collapsed: true })
  assert.equal(f.tree.props['data-wide'], 'false')
  assert.ok(nodes(f.tree).find(x => x.props['aria-label'] === 'toggle.open'))
})

test('frame-owned shell leading renders unconditional native-action reopen controls without a Session hook', () => {
  const f = fixture()
  const Leading = vm.runInNewContext(`${leadingSource}\nSidebarReopenControls`, f.context)
  const tree = Leading(f.props)
  assert.equal(tree.props.className, 'dbt-shell-leading')
  const buttons = nodes(tree).filter(x => x.type === 'button')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[0].props['aria-expanded'], false)
  assert.equal(buttons[0].props['aria-label'], 'toggle.open')
  buttons[0].props.onClick({ detail: 0 })
  buttons[1].props.onClick()
  assert.deepEqual(f.calls, [['toggle'], ['new']])
  assert.doesNotMatch(leadingSource, /useSessions|usePanelInfo|useState|localStorage|selectPanel/)
})

test('static Windows caption contract restores fixed no-drag controls, icon visibility and menu clearance', () => {
  // Inspect source rules only: no browser CSS/geometry/pixel measurements.
  assert.match(source, /html\[data-windows-titlebar\] \.dbt-sidebar \.dbt-toggle\{position:fixed;top:calc\(\(var\(--dsh-windows-titlebar-height\) - 28px\) \/ 2\);left:12px;z-index:30;width:28px;height:28px;-webkit-app-region:no-drag\}/)
  assert.match(source, /html\[data-windows-titlebar\] \.dbt-sidebar\[data-wide="false"\] \.dbt-toggle \.dbt-panel-icon\{display:inline\}/)
  assert.match(source, /html\[data-windows-titlebar\] \.dbt-sidebar\[data-wide="false"\] \.dbt-new-session\{position:fixed;[^}]*left:48px;[^}]*-webkit-app-region:no-drag/)
  assert.match(source, /html\[data-windows-titlebar\]:has\(\.dbt-sidebar\[data-wide="false"\]\)\{--dsh-windows-menu-start:84px\}/)
  assert.match(source, /ctx\.slots\.inject\('shell\.leading', \(\) => ctx\.slots\.register/)
  assert.doesNotMatch(source, /\.sidebarCol|SIDEBAR_COLLAPSED\s*=|createPortal|appendChild\([^)]*button/)
})

test('accepted Desktop frame zero-width collapse and sole layout width owner are not modified', () => {
  const layout = readFileSync(new URL('../forks-0.2.0-rc.2/ui-layout/lib/client.js', import.meta.url), 'utf8')
  assert.match(layout, /const collapsedWidth = darwin \|\| document\.documentElement\.hasAttribute\("data-windows-titlebar"\) \? 0 : 56/)
  assert.match(layout, /const leadingMounted = darwin && sidebarCollapsed/)
  assert.match(layout, /d\.layoutInfo\.sidebar === 0 \? sidebarExpandedPreference : 0/)
  assert.match(source, /toggleSidebar: \(\) => ctx\.layout\.toggleSidebar\(\)/)
  assert.doesNotMatch(rootSource, /layoutInfo|setSidebar\(|layout\.sidebar-width|setCollapsed|sidebarExpandedPreference/)
})
