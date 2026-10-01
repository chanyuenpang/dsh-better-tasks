import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const names = ['IconPanelLeftOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronDownOutlineRegular',
  'IconChevronRightOutlineRegular', 'IconGoalOutlineRegular', 'IconSparkleRegular']

test('task icon wrappers render verified official exports rather than replacement SVG paths', () => {
  const icons = Object.fromEntries(names.map(name => [name, function OfficialIcon() {}]))
  const fragment = source.slice(source.indexOf('function nativeIcon('), source.indexOf('function renderOfficialPinIcon('))
  const result = vm.runInNewContext(`${fragment};({${names.join(',')}})`, {
    requireModule: name => { assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives'); return icons },
    element: (type, props) => ({ type, props }),
  })
  for (const name of names) {
    assert.equal(result[name]({}).type, icons[name])
    assert.equal(result[name]({ size: 14 }).props.size, 14)
  }
  assert.doesNotMatch(fragment, /element\('svg'|localIcon|strokeWidth|viewBox/)
  assert.doesNotMatch(source, /IconCheckOutline14|IconClockOutline16|IconGoalOutline16|IconChecklistOutline14|function renderTaskPinIcon/)
})
test('Todo lifecycle reuses the official done/ongoing/idle dots and fixed glyph seat', () => {
  const rows = source.slice(source.indexOf("if (todoExpanded)"), source.indexOf('if (finalExpanded)'))
  assert.match(rows, /element\(StateDot, \{ state: todo\.status === 'completed' \? 'done' : todo\.status === 'in_progress' \? 'ongoing' : 'idle' \}\)/)
  assert.match(rows, /className: 'dbt-todo-glyph', role: 'img', 'aria-label': t\(/)
  assert.doesNotMatch(rows, /appearance: 'step'|IconCheckOutline|IconClock/)
  assert.match(source, /\.dbt-todo-glyph\{display:grid;place-items:center;flex:none;width:16px;height:16px\}/)
})
test('official filled pin and folder fallback coexist with user-selected project icons', () => {
  assert.match(source, /const \{ IconPinFillRegular \} = requireModule\('@deepseek-ai\/dsh-client-ui-primitives'\)/)
  assert.match(source, /return element\(IconPinFillRegular, \{ size \}\)/)
  assert.match(source, /icon === undefined\) return element\(requireModule\('@deepseek-ai\/dsh-client-ui-primitives'\)\.IconFolderCloseRegular, \{ size \}\)/)
  assert.match(source, /\.\.\.icon\.nodes\.map/)
})
test('native Pin bridge invokes official UI actions without a second membership write channel', () => {
  assert.match(source, /source: ctx\.get\?\.\('workspaces'\)\?\.list/)
  assert.match(source, /pinSession: \(id\) => ctx\.uiWorkspace\.pinSession\(id\)/)
  assert.match(source, /unpinSession: \(id\) => ctx\.uiWorkspace\.unpinSession\(id\)/)
  const client = readFileSync(new URL('../src/pin-client.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(client, /optimisticPins|action: pinned \? 'pin'|action: 'pin-created'/)
  assert.match(client, /pinCreated: sessionId => setPinned\(sessionId, true\)/)
})
test('animation fix does not add a local force-motion override to task or workspace styling', () => {
  const rows = readFileSync(new URL('../.srcbuild/packages/client/ui-workspace/src/client/rows/Rows.module.css', import.meta.url), 'utf8')
  assert.doesNotMatch(source + rows, /runningState|dbt-session-spin|dbt-state-dot-spin|animation[^;}]*!important/)
  assert.match(source, /task\.session\.status === 'running' \? element\(StateDot, \{ state: 'ongoing' \}\)/)
})
