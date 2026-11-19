import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

// Focused owner contracts for the explicitly staged runtime-matched sources.
// No browser/profile, React rendering, visual measurements or real storage are exercised.
const root = '.srcbuild/packages/client/ui-layout/src/client/'
const testSourceVersion = process.env.DSH_FORK_VERSION ?? '0.2.2-rc.3'
assert.equal(JSON.parse(readFileSync('.srcbuild/package.json', 'utf8')).version, testSourceVersion)
const columnsText = readFileSync(root + 'columns.ts', 'utf8')
const storesText = readFileSync(root + 'stores.ts', 'utf8')
const frameText = readFileSync(root + 'AppFrame.tsx', 'utf8')
const strip = text => stripTypeScriptTypes(text, { mode: 'transform' })
const columns = new Function(strip(columnsText).replace(/^export /gm, '') + '\nreturn {clampWidth,sidebarMax,computeColumns,SIDEBAR_MIN,SIDEBAR_DEFAULT,SIDEBAR_AUTO_COLLAPSE,SIDEBAR_DRAWER_BREAKPOINT,RIGHTBAR_DEFAULT_RATIO,RIGHTBAR_MAX_RATIO,RIGHTBAR_MIN}')()
function owner(stored = '1200', { readFails = false, writeFails = false } = {}) {
  const writes = []
  const storage = { getItem() { if (readFails) throw Error('blocked'); return stored }, setItem(key, value) { if (writeFails) throw Error('blocked'); writes.push([key, value]); stored = value } }
  let source = strip(storesText)
  const deps = []
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, id) => {
    const dependency = id === './columns.ts' ? columns : { defineStore: spec => ({ state: spec.init(), actions: spec.actions }) }
    return `const ${names.trim().replace(/\bas\b/g, ':')} = __deps[${deps.push(dependency) - 1}];`
  }).replace(/^export /gm, '')
  const api = new Function('__deps', 'localStorage', 'window', source + '\nreturn {createLayoutStore,currentSidebarPreference,readSidebarWidthPreference}')(deps, storage, { innerWidth: 1400 })
  return { ...api, ...api.createLayoutStore(), writes }
}
const displayed = o => columns.computeColumns(o.state.layoutInfo.viewportWidth, o.state.layoutInfo.sidebar, 0).sidebar

test('rc3 cold restore keeps 1200 intent while 1400 frame displays 840, then restores 1200', () => {
  const o = owner()
  assert.equal(o.currentSidebarPreference(), 1200)
  assert.equal(displayed(o), 840)
  o.actions.setViewportWidth(o.state, 2400)
  assert.equal(displayed(o), 1200)
  assert.equal(o.writes.length, 0)
})
test('resize and collapse/reopen never rewrite the stored intent', () => {
  const o = owner()
  for (const width of [700, 1400, 2400]) o.actions.setViewportWidth(o.state, width)
  o.actions.toggleSidebar(o.state)
  assert.equal(o.state.layoutInfo.sidebar, 0)
  o.actions.toggleSidebar(o.state)
  assert.equal(o.state.layoutInfo.sidebar, 1200)
  assert.equal(o.writes.length, 0)
})
test('actual resize action updates one existing key and still clamps a new drag to its current frame', () => {
  const o = owner()
  o.actions.setSidebar(o.state, 700)
  assert.deepEqual(o.writes, [['dsh-better-tasks.layout.sidebar-width.v1', '700']])
  o.actions.setViewportWidth(o.state, 2400)
  assert.equal(displayed(o), 700)
  o.actions.setViewportWidth(o.state, 1400)
  o.actions.setSidebar(o.state, 9999)
  assert.equal(o.currentSidebarPreference(), 840)
})
test('restore preserves default, finite minimum and rounding without a viewport ceiling', () => {
  for (const value of [null, '', 'NaN', 'Infinity']) assert.equal(owner(value).currentSidebarPreference(), 280)
  assert.equal(owner('80').currentSidebarPreference(), 264)
  assert.equal(owner('1200.5').currentSidebarPreference(), 1201)
})
test('blocked storage does not break initialization or a live width update', () => {
  assert.equal(owner('1200', { readFails: true }).currentSidebarPreference(), 280)
  const o = owner('1200', { writeFails: true })
  assert.doesNotThrow(() => o.actions.setSidebar(o.state, 700))
  assert.equal(o.currentSidebarPreference(), 700)
})
test('sidebar click-only gesture does not persist a constrained edge; a real drag can return to origin', () => {
  const start = frameText.match(/const onSidebarStart = useCallback\(\(\) => \{ ([^\n]+) \}, \[\]\)/)?.[1]
  const drag = frameText.match(/const onSidebarDrag = useCallback\(\(dx: number\) => \{([\s\S]*?)\n  \}, \[actions\]\)/)?.[1]
  assert.ok(start && drag)
  const o = owner(), sidebarBase = { current: 0 }, sidebarMoved = { current: false }
  const begin = new Function('sidebarBase', 'colsRef', 'sidebarMoved', 'setDragging', start)
  const move = new Function('dx', 'actions', 'sidebarBase', 'sidebarMoved', drag)
  const actions = { setSidebar: px => o.actions.setSidebar(o.state, px) }
  begin(sidebarBase, { current: { sidebar: 840 } }, sidebarMoved, () => {})
  move(0, actions, sidebarBase, sidebarMoved)
  assert.equal(o.writes.length, 0)
  assert.equal(o.currentSidebarPreference(), 1200)
  move(-100, actions, sidebarBase, sidebarMoved)
  assert.equal(o.currentSidebarPreference(), 740)
  move(0, actions, sidebarBase, sidebarMoved)
  assert.equal(o.currentSidebarPreference(), 840)
})
