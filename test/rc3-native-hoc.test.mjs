import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { createSidebarChildDeclarations } from '../src/task-model.mjs'

// Exact upstream HOC cache/composition/outlet code over a small registry and
// React entry transport. This is an offline contract, not browser/visual QA.
const requireBuild = createRequire(new URL('../.srcbuild/package.json', import.meta.url))
const ts = requireBuild('typescript'), React = requireBuild('react')
const { renderToStaticMarkup } = requireBuild('react-dom/server')
const fixture = name => readFileSync(new URL('./fixtures/sidebar-rc3/' + name, import.meta.url), 'utf8')
const provenance = JSON.parse(fixture('provenance.json'))
for (const file of provenance.files) {
  assert.equal(createHash('sha256').update(fixture(file.snapshot)).digest('hex'), file.snapshotSha256)
}
function harness() {
  let entries = [], version = 0
  const host = { getVersion: () => version, entriesOfSlot: () => entries, reportEntryError: () => {} }
  const passthrough = ({ children }) => children
  const exports = {}
  const code = ts.transpileModule(fixture('hoc-renderer.tsx'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, {
    exports, require: name => { assert.equal(name, 'react/jsx-runtime'); return requireBuild(name) },
    useHost: () => host, cachedSlotInject: () => undefined,
    HocContentBoundary: passthrough, HocOutletBoundary: passthrough, SlotErrorBoundary: passthrough,
    RootEntry: ({ entry, ownerProps, children }) => React.createElement(entry.component, ownerProps, children),
  })
  const spec = createSidebarChildDeclarations({ iconsInFactory: true })['sidebar.session.action']
  const content = React.createElement('button', { 'data-native-new': true }, 'New Session')
  return {
    content,
    mount(next) { entries = next; version++ },
    outlet(wide = true) { return exports.HocOutlet({ slotKey: 'sidebar.session.action', spec, ownerProps: { wide }, children: content }) },
  }
}

test('rc.3 declaration matches the pinned upstream root/hoc contract', () => {
  assert.equal(provenance.upstreamTag, 'dsh-v0.2.2-rc.3')
  assert.match(fixture('sidebar-contract.txt'), /'sidebar\.session\.action': \{ kind: 'hoc'; scope: 'root'/)
  assert.deepEqual(createSidebarChildDeclarations()['sidebar.session.action'], { kind: 'hoc', scope: 'root' })
})
test('real rc.3 HOC returns original owner content without an optional occupant', () => {
  const f = harness()
  assert.equal(f.outlet(), f.content)
  assert.equal(renderToStaticMarkup(f.outlet()), '<button data-native-new="true">New Session</button>')
})
test('real rc.3 HOC layers preserve children and recover after late registration and unload', () => {
  const f = harness(), owners = []
  const action = { options: { id: 'optional-import' }, component: ({ wide, children }) => {
    owners.push(wide)
    return React.createElement(React.Fragment, null, children, React.createElement('button', { 'data-import': true }, 'Import'))
  } }
  assert.equal(f.outlet(), f.content)
  f.mount([action])
  const html = renderToStaticMarkup(f.outlet(false))
  assert.equal((html.match(/data-native-new/g) ?? []).length, 1)
  assert.equal((html.match(/data-import/g) ?? []).length, 1)
  assert.deepEqual(owners, [false])
  f.mount([])
  assert.equal(f.outlet(), f.content)
})
test('rc.3 workspace bundle retains the upstream reusable picker and directory-flow hole', () => {
  const bundle = readFileSync(new URL('../forks-0.2.2-rc.3/ui-workspace/lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /workspace\.picker["'`]/)
  assert.match(bundle, /workspace\.picker\.directoryFlow/)
  const patch = readFileSync(new URL('../src-patches/ui-workspace/0.2.2-rc.3-better-tasks.patch', import.meta.url), 'utf8')
  assert.doesNotMatch(patch, /^-[^\n]*(?:registerFactory|WorkspacePickerFactory|factoryFlowSource)/m)
})
