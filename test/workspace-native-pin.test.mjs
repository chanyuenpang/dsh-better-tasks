import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import test from 'node:test'
import ts from '../.srcbuild/node_modules/typescript/lib/typescript.js'

// Actual Desktop pure tree/order implementation; only platform utilities/store
// construction are stubbed. No UI rendering, geometry, Host calls or deployment.
const root = resolve('.srcbuild/packages/client/ui-workspace/src/client')
const loaded = new Map()
function load(file) {
  file = resolve(root, file)
  if (loaded.has(file)) return loaded.get(file)
  const source = readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const external = {
    '@deepseek-ai/dsh-util-values': { assertNever: value => { throw new Error(`unreachable ${value}`) } },
    '@deepseek-ai/dsh-util-workspace-path': { workspaceTitleOf: path => path },
    '@deepseek-ai/dsh-client-store': { defineStore: spec => spec },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
    if (name.startsWith('.')) return load(resolve(dirname(file), name))
    assert.ok(name in external, `unexpected runtime import ${name}`)
    return external[name]
  })
  loaded.set(file, module.exports)
  return module.exports
}
const tree = load('tree.ts'), orders = load('pin-order.ts'), stores = load('stores.ts')
const summary = (id, updatedAt, extra = {}) => ({ id, title: id, displayTitle: id, blank: false, origin: 'root', running: false, retainedBy: {}, updatedAt, ...extra })
const list = (...rows) => ({ ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])), projectionsBySession: {}, phase: 'ready' })
const workspace = (id, ids) => ({ workspaceId: id, title: id, path: `G:/fixture/${id}`, sessionIds: ids })
const state = (pins = [], archived = [], archivedFilter = 'default') => ({ pinnedSessionIds: pins, archivedSessionIds: archived, archivedFilter })
const ids = rows => rows.map(row => row.id)
const noStatus = new Map()

test('official grouped pin blocks stay inside each Workspace and Ungrouped, not a new global section', () => {
  const sessions = list(summary('new-a', 40), summary('pin-a', 1), summary('new-b', 30), summary('pin-b', 2), summary('loose', 20), summary('pin-loose', 3))
  const workspaces = [workspace('a', ['new-a', 'pin-a']), workspace('b', ['new-b', 'pin-b'])]
  const groups = tree.deriveGroups(sessions, workspaces, state(['pin-b', 'pin-loose', 'pin-a']), noStatus,
    { expandedGroups: ['a', 'b', tree.UNGROUPED_KEY] })
  assert.deepEqual(groups.map(group => group.key), ['a', 'b', tree.UNGROUPED_KEY])
  assert.deepEqual(groups.map(group => ids(group.sessions)), [['pin-a', 'new-a'], ['pin-b', 'new-b'], ['pin-loose', 'loose']])
})

test('official flat pin block spans Workspaces while preserving project appearance', () => {
  const sessions = list(summary('plain', 9), summary('pin-a', 1), summary('pin-b', 2))
  const appearance = { icon: 'folder', color: '#123456' }
  const rows = tree.deriveFlat(sessions, sessions.ids, state(['pin-b', 'pin-a']), noStatus,
    [workspace('a', ['pin-a'])], new Map([['a', appearance]]))
  assert.deepEqual(ids(rows), ['pin-a', 'pin-b', 'plain'])
  assert.equal(rows[0].projectAppearance, appearance)
})

test('updated mode orders within the native pin block by recency, not pin-array recency', () => {
  const sessions = list(summary('old-pin', 1), summary('new-pin', 4), summary('new-plain', 9), summary('old-plain', 2))
  const order = tree.orderByRecency(sessions.ids, sessions.byId)
  assert.deepEqual(ids(tree.deriveFlat(sessions, order, state(['old-pin', 'new-pin']), noStatus)), ['new-pin', 'old-pin', 'new-plain', 'old-plain'])
})

test('manual mode preserves pinned relative order and unpin does not rewrite saved positions', () => {
  const sessions = list(summary('old-pin', 1), summary('new-pin', 4), summary('plain', 9))
  const saved = ['plain', 'old-pin', 'new-pin']
  const pinState = state(['new-pin', 'old-pin'])
  const order = tree.reconcileManualOrder(sessions.ids, saved, sessions.byId, pinState)
  assert.deepEqual(ids(tree.deriveFlat(sessions, order, pinState, noStatus)), ['old-pin', 'new-pin', 'plain'])
  assert.deepEqual(ids(tree.deriveFlat(sessions, order, state(['new-pin']), noStatus)), ['new-pin', 'plain', 'old-pin'])
  assert.deepEqual(saved, ['plain', 'old-pin', 'new-pin'])
})

test('current blank remains first and an archived pin never joins the leading block', () => {
  const sessions = list(summary('plain', 5), summary('pin', 2), summary('archived', 3), summary('blank', 1, { blank: true, retainedBy: { mainView: 1 } }), summary('hidden-blank', 6, { blank: true }))
  const rows = tree.deriveFlat(sessions, sessions.ids, state(['pin', 'archived'], ['archived'], 'show'), noStatus)
  assert.deepEqual(ids(rows), ['blank', 'pin', 'plain', 'archived'])
  assert.equal(rows.at(-1).pinned, false)
})

test('native pin fronting affects own Workspace and flat accounts, not grouping or orderBy policy', () => {
  const sessions = list(summary('plain', 9), summary('pin', 2), summary('other', 4))
  const workspaces = [workspace('a', ['plain', 'pin']), workspace('b', ['other'])]
  const spec = stores.createWorkspaceViewStore(), view = spec.init()
  view.sessionOrderByAccount = { a: ['plain', 'pin'], b: ['other'], [stores.FLAT_SESSION_ORDER_KEY]: ['plain', 'other', 'pin'] }
  const source = orders.pinOrderSource(workspaces, sessions, state(['pin']))
  const accounts = orders.pinOrderAccounts(workspaces, 'pin')
  assert.deepEqual(accounts, ['a', stores.FLAT_SESSION_ORDER_KEY])
  spec.actions.pinSessionOrder(view, 'pin', accounts, source)
  assert.deepEqual(view.sessionOrderByAccount.a, ['pin', 'plain'])
  assert.deepEqual(view.sessionOrderByAccount.b, ['other'])
  assert.deepEqual(view.sessionOrderByAccount[stores.FLAT_SESSION_ORDER_KEY], ['pin', 'plain', 'other'])
  assert.equal(view.orderBy, 'updated'); assert.equal(view.groupBy, 'workspace')
})

test('navigation retains official Host-ack then current-snapshot pin order policy', () => {
  const source = readFileSync(resolve(root, 'navigation.ts'), 'utf8')
  assert.match(source, /async pinSession\(sessionId: SessionId\): Promise<void> \{\s*await this\.workspaces\.pinSession\(sessionId\)\s*const \{ items, pinnedSessionIds, archivedSessionIds \} = this\.workspaces\.list\.getSnapshot\(\)/)
  assert.match(source, /this\.view\.pinSessionOrder\(\s*sessionId,\s*pinOrderAccounts\(items, sessionId\),\s*pinOrderSource\(items, this\.sessions\.list\.getSnapshot\(\), \{ pinnedSessionIds, archivedSessionIds \}\)/)
  assert.match(source, /async unpinSession\(sessionId: SessionId\): Promise<void> \{\s*await this\.workspaces\.unpinSession\(sessionId\)\s*\}/)
  const browser = readFileSync(resolve(root, 'rows/WorkspaceBrowser.tsx'), 'utf8')
  assert.match(browser, /source\.pinned !== drag\.pinned \|\| target\.pinned !== drag\.pinned/)
})

for (const file of ['index.ts', 'contract/slots.ts', 'rows/Rows.tsx', 'rows/WorkspaceBrowser.tsx', 'locales.ts']) {
  test(`modified Desktop ${file} emits matching public declarations`, () => {
    const source = readFileSync(resolve(root, file), 'utf8')
    const result = ts.transpileDeclaration(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
    assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')), [])
    assert.doesNotMatch(result.outputText, /TaskPinSnapshot|TaskPinIcon|taskPins|setTaskPinned|pinPending|onSetPinned/)
  })
}
