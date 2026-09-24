import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const forkUrl = new URL('../forks/ui-workspace/lib/client.js', import.meta.url)
const manifestUrl = new URL('../forks/ui-workspace/package.json', import.meta.url)

function count(source, value) {
  return source.split(value).length - 1
}

test('workspace fork preserves canonical identity and single registrants', async () => {
  const [source, manifest] = await Promise.all([
    readFile(forkUrl, 'utf8'),
    readFile(manifestUrl, 'utf8').then(JSON.parse),
  ])
  assert.equal(manifest.name, '@deepseek-ai/dsh-client-ui-workspace')
  assert.equal(manifest.version, '0.1.5-rc.2')
  assert.equal(count(source, 'id: "@deepseek-ai/dsh-client-ui-workspace"'), 1)
  assert.equal(count(source, 'new UiWorkspaceService('), 1)
  assert.equal(count(source, 'ctx.slots.inject("sidebar.workspaces"'), 1)
  assert.equal(count(source, 'ctx.slots.inject("conversation.hero.workspace"'), 1)
})

test('activity filtering preserves full hidden-id order accounts', async () => {
  const source = await readFile(forkUrl, 'utf8')
  assert.match(source, /activityRange: "all"/)
  assert.match(source, /const allGroups = .*deriveGroups/)
  assert.match(source, /sessions: group\.sessions\.filter\(\(session\) => sessionInActivityRange/)
  assert.match(source, /const orderedRows =[\s\S]*?reconciledSessionOrder/)
  assert.match(source, /const rows = .*orderedRows\.filter\(\(row\) => sessionInActivityRange/)
  assert.match(source, /const nextOrder = orderedRows\.map\(\(row\) => row\.id\)/)
  assert.doesNotMatch(source, /const nextOrder = rows\.map\(\(row\) => row\.id\)/)
  assert.match(source, /items: all\.items\.filter\(\(item\) => sessionInActivityRange/)
})

test('row pin action uses shared projection and cannot bubble into open or drag', async () => {
  const source = await readFile(forkUrl, 'utf8')
  assert.match(source, /"betterTaskPins"/)
  assert.match(source, /taskPins: taskPins\.source/)
  assert.match(source, /setTaskPinned: \(sessionId, pinned\) => taskPins\.setPinned/)
  assert.match(source, /"aria-pressed": pinned/)
  assert.match(source, /function TaskPinIcon/)
  assert.match(source, /M15 4\.5l-4 4l-4 1\.5l-1\.5 1\.5l7 7l1\.5 -1\.5l1\.5 -4l4 -4/)
  assert.match(source, /children: \(0, react_jsx_runtime\.jsx\)\(TaskPinIcon, \{\}\)/)
  assert.equal(count(source, '"data-dbt-pinned-title-marker"'), 1)
  assert.match(source, /children: \[pinned &&[\s\S]*?"aria-hidden": true[\s\S]*?children: "📌"[\s\S]*?, title\]/)
  assert.doesNotMatch(source, /IconCloseOutline16|IconQueueOutline14/)
  assert.match(source, /onPointerDown: \(e\) => \{ e\.stopPropagation\(\); \}/)
  assert.match(source, /onDragStart: \(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}/)
})

test('every New Session route passes one lifecycle seam before navigation opens', async () => {
  const source = await readFile(forkUrl, 'utf8')
  assert.match(source, /onSessionCreated\(listener\)/)
  assert.match(source, /this\.sessionCreatedListeners\.add\(listener\)/)
  assert.match(source, /this\.notifySessionCreated\(sessionId\);\s*beforeOpen\?\.\(sessionId\);\s*if \(isCurrent\(\)\) this\.openSession/)
  assert.match(source, /startSession\(workspaceId, beforeOpen\)/)
  assert.match(source, /this\.openWorkspace\(target, beforeOpen\)/)
  assert.match(source, /Promise\.resolve\(listener\(sessionId\)\)\.catch/)
  assert.match(source, /this\.sessionCreatedListeners\.clear\(\)/)
})

test('cold startup opens the restored current Session binding before Goal actions', async () => {
  const source = await readFile(forkUrl, 'utf8')
  assert.match(source, /if \(sessions\.current !== void 0\) \{\s*if \(this\.sessions\.binding\(sessions\.current\) === void 0\) this\.sessions\.open\(sessions\.current\);\s*initial = "done"/)
})

test('installed project appearance behavior remains in the fork', async () => {
  const source = await readFile(forkUrl, 'utf8')
  assert.match(source, /openProjectAppearancePicker/)
  assert.match(source, /useProjectAppearances/)
  assert.match(source, /projectAppearance/)
})
