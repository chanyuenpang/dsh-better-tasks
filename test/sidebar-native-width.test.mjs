import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('native workspace region stretches across the resized sidebar without requiring flex-grow', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const panel = source.match(/\.dbt-region-panel\{([^}]+)\}/)?.[1]
  assert.ok(panel)
  // rc.2's native WorkspaceBrowser uses flex:none in its expanded state.
  // A row parent shrink-wraps it; a column parent stretches its cross axis.
  assert.match(panel, /display:flex;/)
  assert.match(panel, /flex-direction:column;/)
  assert.match(panel, /min-width:0;/)
  assert.match(source, /view === 'native' \? renderSlot\('sidebar.workspaces'/)
})
