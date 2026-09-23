import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const layoutUrl = new URL('../forks/ui-layout/lib/client.js', import.meta.url)
const sidebarUrl = new URL('../src/client.js', import.meta.url)

async function source(url) { return readFile(url, 'utf8') }

test('ui-layout fork remains the canonical single layout and root owner', async () => {
  const value = await source(layoutUrl)
  assert.equal(value.match(/id: "@deepseek-ai\/dsh-client-ui-layout"/g)?.length, 1)
  assert.equal(value.match(/ctx\.reflect\.provide\("layout", layout\)/g)?.length, 1)
  assert.equal(value.match(/name: "root"/g)?.length, 1)
  assert.equal(value.match(/ctx\.slots\.provideRoot\(/g)?.length, 1)
})

test('layout owner restores one namespaced positive preference with a dynamic half-viewport ceiling', async () => {
  const value = await source(layoutUrl)
  assert.match(value, /const SIDEBAR_MIN = 264/)
  assert.match(value, /const SIDEBAR_MAX = 840/)
  assert.match(value, /const SIDEBAR_DEFAULT = 280/)
  assert.match(value, /dsh-better-tasks\.layout\.sidebar-width\.v1/)
  assert.match(value, /function sidebarMax\(viewport\) \{[\s\S]*?Math\.max\(SIDEBAR_MAX, viewport \* \.5\)/)
  assert.match(value, /Number\.isFinite\(stored\) \? clampWidth\(stored, SIDEBAR_MIN, sidebarMax\(window\.innerWidth\)\) : SIDEBAR_DEFAULT/)
  assert.match(value, /clampWidth\(px, SIDEBAR_MIN, sidebarMax\(d\.layoutInfo\.viewportWidth\)\)/)
  assert.match(value, /sidebarExpandedPreference = width;[\s\S]*?writeSidebarWidthPreference\(width\)/)
  assert.match(value, /d\.layoutInfo\.sidebar === 0 \? sidebarExpandedPreference : 0/)
  assert.doesNotMatch(value, /clampWidth\(px, 264, 420\)/)
})

test('task grid supports auto, fixed single, and fixed double layouts', async () => {
  const value = await source(sidebarUrl)
  assert.match(value, /const TASK_GRID_TWO_COLUMN_THRESHOLD = 528/)
  assert.match(value, /const twoColumns = !collapsed && \(preferences\.columnLayout === 'double' \|\| \(preferences\.columnLayout === 'auto' && width > TASK_GRID_TWO_COLUMN_THRESHOLD\)\)/)
  assert.match(value, /const preferences = useTaskPreferences\(\(snapshot\) => snapshot\.value\)/)
  assert.match(value, /'data-columns': twoColumns \? '2' : '1'/)
  assert.match(value, /\.dbt-task-list\[data-columns="2"\]\{display:flex;align-items:flex-start\}/)
  assert.match(value, /className: 'dbt-task-column'[\s\S]*?index % 2 === 0[\s\S]*?index % 2 === 1/)
  assert.doesNotMatch(value, /grid-template-columns:repeat\(2/)
})
