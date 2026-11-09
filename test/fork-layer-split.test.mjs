import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { compare } from '../scripts/check-upstream-contract.mjs'

// The a layer is split between two mechanisms, and each has a real cost:
//
//   patch    - a few hunks inside an upstream file. Cheap to review and the
//              forward keeps upstream's improvements, but every tag that touches
//              those lines costs a merge.
//   takeover - our whole copy of an upstream module. Forward never conflicts,
//              but upstream's edits to that module stop reaching us silently, so
//              the checker has to report them.
//
// These tests hold both boundaries.

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const lock = JSON.parse(await readFile(join(root, 'provenance', 'source.lock.json'), 'utf8'))
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

/**
 * Count hunks and files in one recorded patch.
 * @param text - unified diff text.
 * @returns hunk and file counts.
 */
function counts(text) {
  const chunks = text.split(/^=+$/m).filter((chunk) => /^--- "?a\//m.test(chunk))
  let hunks = 0
  for (const chunk of chunks) hunks += chunk.split(/^@@ /m).length - 1
  return { files: chunks.length, hunks }
}

test('the review surface stays small on every fork', async () => {
  // The layer split exists to shrink what a human reads on an upgrade. Before it
  // this was 200 hunks across 32 upstream files; the regression to guard is
  // drifting back toward that.
  const totals = { files: 0, hunks: 0 }
  for (const slug of slugs) {
    const path = join(root, 'src-patches', slug, lock.version + '-better-tasks.patch')
    if (!existsSync(path)) continue
    const { files, hunks } = counts(await readFile(path, 'utf8'))
    totals.files += files
    totals.hunks += hunks
    assert.ok(hunks <= 25, slug + ': ' + hunks + ' hunks is more than this fork should still need as a patch')
  }
  assert.ok(totals.hunks <= 90, 'patch hunks across the library: ' + totals.hunks + ' (target <= 90)')
  assert.ok(totals.files <= 25, 'patched upstream files: ' + totals.files + ' (target <= 25)')
})

test('every a-layer file is a real module, not a diff fragment', async () => {
  const files = []
  const walk = async (at) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const child = join(at, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) files.push(child)
    }
  }
  await walk(join(root, 'src-overlay'))
  assert.ok(files.length >= 20, 'the a layer should hold the extracted modules, found ' + files.length)
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    assert.ok(!/^@@ /m.test(text), file + ' contains diff hunk headers')
    assert.ok(!/^\+\+\+ b\//m.test(text), file + ' contains diff file headers')
  }
})

test('a taken-over module whose upstream moved is reported, not silently won', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'takeover-'))
  try {
    const rel = 'packages/client/ui-layout/src/client/stores.ts'
    const from = join(scratch, 'deepseek-harness-dsh-v0.0.1')
    const to = join(scratch, 'deepseek-harness-dsh-v0.0.2')
    for (const [tree, body] of [[from, 'export const width = 1\n'], [to, 'export const width = 2\n']]) {
      await mkdir(join(tree, 'packages/client/ui-layout/src/client'), { recursive: true })
      await writeFile(join(tree, rel), body)
    }
    // Our layer shadows that very path: forwarding installs `to`, but our copy
    // wins, so upstream's width=2 silently never reaches the product.
    const inventory = [{ slug: 'ui-layout', rel, body: 'export const width = 1 // ours\n' }]
    const report = await compare(from, to, inventory)
    const entry = report.takeovers.find((item) => item.path === rel)
    assert.ok(entry !== undefined, 'the takeover must appear in the report')
    assert.equal(entry.changedUpstream, true, 'upstream moved, so the takeover needs re-applying')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('a takeover upstream did not move is clean', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'takeover-'))
  try {
    const rel = 'packages/client/ui-layout/src/client/stores.ts'
    const from = join(scratch, 'deepseek-harness-dsh-v0.0.1')
    const to = join(scratch, 'deepseek-harness-dsh-v0.0.2')
    for (const tree of [from, to]) {
      await mkdir(join(tree, 'packages/client/ui-layout/src/client'), { recursive: true })
      await writeFile(join(tree, rel), 'export const width = 1\n')
    }
    const inventory = [{ slug: 'ui-layout', rel, body: 'export const width = 1 // ours\n' }]
    const report = await compare(from, to, inventory)
    assert.equal(report.takeovers[0].changedUpstream, false)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('the checker warns when the from-tree is not the pinned tag', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'direction-'))
  try {
    const from = join(scratch, 'deepseek-harness-dsh-v9.9.9')
    const to = join(scratch, 'deepseek-harness-dsh-v9.9.10')
    await mkdir(from, { recursive: true })
    await mkdir(to, { recursive: true })
    const warnings = []
    const original = console.warn
    console.warn = (message) => warnings.push(String(message))
    try {
      await compare(from, to, [])
    } finally {
      console.warn = original
    }
    assert.ok(
      warnings.some((line) => line.includes('warning: --from tree is 9.9.9')),
      'running from a tree other than the pinned tag must warn: ' + JSON.stringify(warnings),
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
