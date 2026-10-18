import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../.srcbuild/packages/client/ui-workspace/src/client/', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

test('Desktop workspace has no optional Better Tasks pin bridge or duplicate pin DTO', async () => {
  await assert.rejects(access(new URL('task-pins.ts', root)), { code: 'ENOENT' })
  for (const path of ['index.ts', 'contract/slots.ts', 'rows/WorkspaceBrowser.tsx', 'rows/Rows.tsx']) {
    const source = await read(path)
    assert.doesNotMatch(source, /betterTaskPins|TaskPinSnapshot|TaskPinsHook|TaskPinIcon|useTaskPins|setTaskPinned|onSetPinned|pinPending/, path)
  }
})

test('native core activation and exactly one official Pin registration per seat are preserved', async () => {
  const source = await read('index.ts')
  const deps = source.match(/export const inject(?:\s*:\s*string\[\])? = \[([\s\S]*?)\]/)?.[1]
  assert.ok(deps)
  assert.doesNotMatch(deps, /betterTask|taskPins/)
  assert.match(source, /new UiWorkspaceService\(/)
  assert.match(source, /provideRoot\(\{\s*hooks: \{ workspaces: workspaces\.list \}/)
  assert.equal((source.match(/name: 'sidebar\.workspaces\.session\.menu\.item', id: 'pin'/g) ?? []).length, 1)
  assert.equal((source.match(/name: 'sidebar\.workspaces\.session\.row\.action', id: 'pin'/g) ?? []).length, 1)
  assert.match(source, /uiWorkspace\.pinSession\(sessionId\)\.catch\(\(\) => \{ notify\(\{ kind: 'pinFailed' \}\) \}\)/)
  assert.match(source, /uiWorkspace\.unpinSession\(sessionId\)\.catch\(\(\) => \{ notify\(\{ kind: 'unpinFailed' \}\) \}\)/)
})

test('rows retain official indicator and action seats without task title emoji or second pin button', async () => {
  const source = await read('rows/Rows.tsx')
  assert.doesNotMatch(source, /📌|data-dbt-pinned-title-marker|task pin rejected|pin\.add|pin\.remove|M15 4\.5l-4/)
  assert.match(source, /row\.pinned && !row\.archived && <PinnedIndicator t=\{t\} \/>/)
  assert.match(source, /<IconPinFillRegular size=\{14\} \/>/)
  assert.match(source, /renderSlot\('sidebar\.workspaces\.session\.row\.action'/)
  assert.match(source, /'sidebar\.workspaces\.session\.menu\.item'/)
  assert.match(source, /rowActions\} onClick=\{\(e\) => \{ e\.stopPropagation\(\) \}\}/)
  const native = await read('session-actions/PinSession.tsx')
  assert.match(native, /pinned \? <IconPinFillRegular size=\{14\} \/> : <IconPinOutlineRegular size=\{14\} \/>/)
  assert.match(native, /if \(archived\) return null/)
})

test('only duplicate pin copy is removed; official labels and accepted appearance/activity features survive', async () => {
  const locales = await read('locales.ts')
  assert.doesNotMatch(locales, /'pin\.add'|'pin\.remove'/)
  for (const key of ['row.pinned', 'actions.pin', 'actions.unpin', 'menu.pinSession', 'menu.unpinSession', 'appearance.menu', 'activityRange.all']) assert.ok(locales.includes(`'${key}'`), key)
  const browser = await read('rows/WorkspaceBrowser.tsx')
  assert.match(browser, /sessions: group\.sessions\.filter\(row => sessionInActivityRange/)
  assert.match(browser, /orderedRows\.filter\(row => sessionInActivityRange/)
  assert.match(browser, /sessionDragOrder\(sessionIds, orderedRows, activeDrag, over\)/)
  assert.match(browser, /useProjectAppearances\(\)/)
  assert.match(browser, /session\.retainedBy\.mainView/)
  assert.match(browser, /usePanelInfo\(info => info\.activePanelId !== null\)/)
})

test('New Session seam remains independent, pre-navigation and rejection-contained', async () => {
  const source = await read('navigation.ts')
  assert.match(source, /onSessionCreated\(listener: SessionCreatedListener\): \(\) => void/)
  assert.match(source, /this\.sessionCreatedListeners\.add\(listener\)/)
  assert.match(source, /Promise\.resolve\(listener\(sessionId\)\)\.catch/)
  assert.match(source, /if \(navigation\.aborted\) return\s*this\.notifySessionCreated\(sessionId\)\s*this\.replaceMain/)
  assert.match(source, /this\.sessionCreatedListeners\.clear\(\)/)
  // 0.2.1-rc.2 turned startSession's second argument into StartSessionOptions, so the fork keeps
  // the observer callback through a union and hands the composed preparation to openWorkspace.
  assert.match(source, /const runBeforeOpen = beforeOpen === undefined\s*\? prepareDraft\s*: prepareDraft === undefined\s*\? beforeOpen\s*: \(id: SessionId\): void => \{ beforeOpen\(id\); prepareDraft\(id\) \}/)
  assert.match(source, /const opening = this\.openWorkspace\(target, runBeforeOpen, agentPreset === undefined \? \{\} : \{ agentPreset \}\)/)
  assert.match(source, /void opening\.catch\(/)
})
