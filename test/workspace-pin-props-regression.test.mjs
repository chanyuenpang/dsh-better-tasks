import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from '../.srcbuild/node_modules/typescript/lib/typescript.js'

// Execute current Desktop TSX prop construction, not the stale legacy bundle.
// Child components remain elements; no browser/effects/visual approximation.
const source = await readFile(new URL('../.srcbuild/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
function fixture() {
  const noop = () => {}, jsx = (type, props) => ({ type, props })
  const dependencies = {
    react: { useMemo: fn => fn(), useEffect: noop, useState: value => [value, noop], useRef: value => ({ current: value }) },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, { get: (_, key) => String(key) }),
    clsx: { default: () => '' },
    '@deepseek-ai/dsh-api-workspace-controller/default-workspace': { workspaceDisplayTitle: value => value },
    '../tree.ts': { sessionMemberIds: () => [], orderByRecency: value => value, reconcileManualOrder: value => value, pinCurrentBlank: value => value, UNGROUPED_KEY: '' },
    '../project-appearance.tsx': { useProjectAppearances: () => new Map() },
    '../stores.ts': { FLAT_SESSION_ORDER_KEY: '__flat_session_order__' },
    '../activity-range.ts': { ACTIVITY_RANGE_ORDER: ['all', '1d', '3d', '7d', '14d'] },
    './Rows.tsx': {}, './AnimatedRows.tsx': {}, '../WorkspacePicker.tsx': {}, './WorkspaceBrowser.module.css': { default: {} },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
    assert.ok(name in dependencies, `unexpected runtime import: ${name}`)
    return dependencies[name]
  })
  const workspaces = { items: [], phase: 'ready', state: 'idle', archivedSessionIds: [], pinnedSessionIds: ['native-pin'] }
  const view = { groupBy: 'flat', orderBy: 'updated', activityRange: 'all', archivedFilter: 'default', groupExpansion: {}, sessionOrderByAccount: {} }
  const props = {
    wide: true,
    useHostInfo: select => select({ home: '' }), useShortcuts: select => select([]),
    useWorkspaceShortcuts: select => select({ addRequested: false, forkError: null }),
    useSessions: select => select({ ids: [], byId: {}, phase: 'ready' }),
    useWorkspaces: select => select(workspaces), useDirectoryFlow: select => select(false),
    useStore: select => select(view), actions: new Proxy({}, { get: () => noop }), t: key => key,
  }
  return { props, workspaces, view, render: () => module.exports.WorkspaceBrowser(props) }
}
function findElement(value, name) {
  if (!value || typeof value !== 'object') return undefined
  if (value.type === name || value.type?.name === name) return value
  for (const child of Array.isArray(value) ? value : Object.values(value.props ?? {})) {
    const found = findElement(child, name)
    if (found) return found
  }
}
for (const [groupBy, component] of [['flat', 'FlatList'], ['workspace', 'SessionTree'], ['workspace-tree', 'SessionTree']]) {
  test(`Desktop ${groupBy} branch works without task-pin props and receives official membership`, () => {
    const state = fixture(); state.view.groupBy = groupBy
    Object.defineProperties(state.props, {
      useTaskPins: { get() { throw new Error('obsolete task-pin hook read') } },
      setTaskPinned: { get() { throw new Error('obsolete task-pin callback read') } },
    })
    const child = findElement(state.render(), component)
    assert.ok(child, `${component} rendered`)
    assert.ok(!('useTaskPins' in child.props) && !('setTaskPinned' in child.props))
    assert.deepEqual(child.props.rowState.pinnedSessionIds, ['native-pin'])
    assert.equal(child.props.activityRange, 'all')
    assert.equal(child.props.nestWorkspaces, component === 'SessionTree' ? groupBy === 'workspace-tree' : undefined)
    state.workspaces.pinnedSessionIds = ['remote-pin']
    assert.deepEqual(findElement(state.render(), component).props.rowState.pinnedSessionIds, ['remote-pin'])
  })
}
test('collapsed Desktop workspace does not evaluate either list branch', () => {
  const state = fixture(); state.props.wide = false
  assert.equal(findElement(state.render(), 'FlatList'), undefined)
  assert.equal(findElement(state.render(), 'SessionTree'), undefined)
})
test('Desktop source contains no deleted bridge prop at any nested row branch', () => {
  assert.doesNotMatch(source, /useTaskPins|setTaskPinned|TaskPinSnapshot|onSetPinned|pinPending/)
  assert.match(source, /const pinnedSessionIds = useWorkspaces\(state => state\.pinnedSessionIds\)/)
  assert.equal((source.match(/rowState=\{rowState\}/g) ?? []).length >= 2, true)
})
