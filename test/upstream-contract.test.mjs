import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { compare, declaredSlots, editedFilesOf, exportedNames, overlayFilesOf } from '../scripts/check-upstream-contract.mjs'

// The checker answers one question — "does the a layer still attach to the next
// upstream tag?" — before anything is built. Its failure modes are about
// misreporting, not crashing: a false BROKEN verdict costs a day, and a missed
// BROKEN verdict ships a broken fork. These tests pin both directions.

test('exportedNames reads every declaration form the client packages use', () => {
  const source = [
    "export const inject = ['slots']",
    'export function apply(ctx) {}',
    'export interface ILayout { toggleSidebar(): void }',
    "export type { StartSessionOptions, UiWorkspace } from './navigation.ts'",
    'export class LayoutController implements ILayout {}',
    'export type MainPanelId = string',
    'export { alpha, beta as gamma }',
    'declare const internal: number',
    'export default function main() {}',
  ].join('\n')
  const names = exportedNames(source)
  for (const expected of ['inject', 'apply', 'ILayout', 'LayoutController', 'MainPanelId', 'StartSessionOptions', 'UiWorkspace', 'alpha', 'gamma']) {
    assert.ok(names.includes(expected), 'missing export ' + expected)
  }
  // A non-exported declaration and the default name must not appear: reporting
  // them as exports would fabricate drift on every tag.
  assert.ok(!names.includes('internal'))
  assert.ok(!names.includes('default'))
})

test('quoted native child keys are checked, not mistaken for absent extension seats', () => {
  const text = `const unrelated = { 'not.a.slot': { kind: 'single' } };
ctx.slots.register({ name: 'sidebar', children: {
  'sidebar.panellist.actions': { kind: 'list', scope: 'root' },
  "sidebar.workspaces": { kind: "single", scope: 'root' },
  bare: { kind: 'keyed' },
} }, Component)`
  assert.deepEqual([...declaredSlots(text)], [
    ['sidebar.panellist.actions','list'],['sidebar.workspaces','single'],['bare','keyed'],
  ])
})

test('a star re-export never fabricates removals', () => {
  // The members of `export * from` are not textually knowable, so the scan must
  // stay silent rather than guess that everything disappeared.
  assert.deepEqual(exportedNames("export * from './x.ts'"), [])
})

test('overlayFilesOf and editedFilesOf split the a layer from upstream edits', () => {
  const separator = '===' + '='.repeat(60)
  const patch = [
    separator,
    '--- "a/packages/client/ui-layout/src/client/stores.ts"',
    '+++ "b/packages/client/ui-layout/src/client/stores.ts"',
    '@@ -6,3 +6,4 @@',
    ' import x',
    '+import y',
    separator,
    '--- "a/packages/client/ui-layout/src/client/region-boundary.tsx"',
    '+++ "b/packages/client/ui-layout/src/client/region-boundary.tsx"',
    '@@ -0,0 +1,2 @@',
    '+export const a = 1',
    '+export const b = 2',
  ].join('\n')

  const created = overlayFilesOf(patch)
  assert.deepEqual([...created.keys()], ['packages/client/ui-layout/src/client/region-boundary.tsx'])
  assert.equal(
    created.get('packages/client/ui-layout/src/client/region-boundary.tsx'),
    'export const a = 1\nexport const b = 2\n',
  )

  assert.deepEqual([...editedFilesOf(patch)], ['packages/client/ui-layout/src/client/stores.ts'])
})

test('a changed module keeps the layer attachable; a vanished one does not', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'contract-check-'))
  try {
    const makeTree = async (root, files) => {
      for (const [rel, body] of Object.entries(files)) {
        const path = join(root, rel)
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, body)
      }
    }
    const from = join(scratch, 'from')
    const to = join(scratch, 'to')
    await makeTree(from, {
      'packages/client/ui-layout/src/client/stores.ts': 'export const width = 1\n',
      'packages/client/ui-layout/src/client/untouched.ts': 'export const gone = 1\n',
    })
    await makeTree(to, {
      // Same exports, different body: our imports still resolve.
      'packages/client/ui-layout/src/client/stores.ts': 'export const width = 1\nexport const height = 2\n',
    })

    // One a-layer file that imports the surviving module, one that imports the
    // deleted one. Only the second may be reported.
    const inventory = [
      { slug: 'ui-layout', rel: 'packages/client/ui-layout/src/client/ours.ts', body: "import { width } from './stores.ts'\nexport const use = width\n" },
      { slug: 'ui-layout', rel: 'packages/client/ui-layout/src/client/miss.ts', body: "import { gone } from './untouched.ts'\nexport const use = gone\n" },
    ]
    const report = await compare(from, to, inventory)

    const stores = report.modules.find((entry) => entry.path.endsWith('stores.ts'))
    assert.equal(stores.status, 'compatible', 'a body change with the same exports stays attachable')

    const untouched = report.modules.find((entry) => entry.path.endsWith('untouched.ts'))
    assert.equal(untouched.status, 'incompatible', 'a deleted module must be reported')
    assert.deepEqual(report.affectedFiles, ['packages/client/ui-layout/src/client/miss.ts'])
    assert.equal(report.incompatible, true)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('a module we never import is not our problem', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'contract-check-'))
  try {
    const from = join(scratch, 'from')
    const to = join(scratch, 'to')
    await mkdir(from, { recursive: true })
    await mkdir(to, { recursive: true })
    const report = await compare(from, to, [])
    assert.deepEqual(report.modules, [])
    assert.equal(report.incompatible, false)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
