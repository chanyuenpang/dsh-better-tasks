import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { compare } from '../scripts/check-upstream-contract.mjs'

// The checker must distinguish two very different facts:
//
//   "upstream dropped an export WE import"     -> our layer is broken
//   "upstream dropped an export we never touch" -> its API changed, we are fine
//
// Conflating them was a real false positive: ui-commands/resolution.ts dropped three
// builtin-command exports in 0.2.2 that our takeover never imports, and the check
// still called the layer incompatible.

async function tree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body)
  }
}

test('an export we bind disappearing breaks the layer', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'contract-'))
  try {
    const rel = 'packages/client/ui-commands/src/client/resolution.ts'
    const from = join(scratch, 'deepseek-harness-dsh-v0.0.1')
    const to = join(scratch, 'deepseek-harness-dsh-v0.0.2')
    await tree(from, { [rel]: 'export function claimToken() {}\nexport function resolveCommand() {}\n' })
    await tree(to, { [rel]: 'export function claimToken() {}\n' })

    const inventory = [{
      slug: 'ui-commands',
      rel: 'packages/client/ui-commands/src/client/service.ts',
      // `claimToken` is bound; `resolveCommand` disappears without us caring.
      body: "import { claimToken } from './resolution.ts'\nexport const use = claimToken\n",
    }]
    const report = await compare(from, to, inventory)
    const entry = report.modules.find((item) => item.path.endsWith('resolution.ts'))
    assert.equal(entry.status, 'compatible')
    assert.deepEqual(entry.removedExports, [])
    assert.deepEqual(entry.unusedRemovals, ['resolveCommand'])
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('the same removal breaks the layer when we do bind it', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'contract-'))
  try {
    const rel = 'packages/client/ui-commands/src/client/resolution.ts'
    const from = join(scratch, 'deepseek-harness-dsh-v0.0.1')
    const to = join(scratch, 'deepseek-harness-dsh-v0.0.2')
    await tree(from, { [rel]: 'export function claimToken() {}\nexport function resolveCommand() {}\n' })
    await tree(to, { [rel]: 'export function claimToken() {}\n' })

    const inventory = [{
      slug: 'ui-commands',
      rel: 'packages/client/ui-commands/src/client/service.ts',
      body: "import { resolveCommand } from './resolution.ts'\nexport const use = resolveCommand\n",
    }]
    const report = await compare(from, to, inventory)
    const entry = report.modules.find((item) => item.path.endsWith('resolution.ts'))
    assert.equal(entry.status, 'incompatible')
    assert.deepEqual(entry.removedExports, ['resolveCommand'])
    assert.equal(report.incompatible, true)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
