import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// The exception list in docs/fork-layers.md is the contract that keeps the patch
// surface honest: every remaining patch hunk must carry a reason, and the reason
// must name a file that actually still needs a patch. A stale row is worse than no
// row — it tells the next maintainer that a file is intentional when it is simply
// forgotten.

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const lock = JSON.parse(await readFile(join(root, 'provenance', 'source.lock.json'), 'utf8'))
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

/**
 * List the upstream files that still carry a recorded patch.
 * @returns repo-relative `<slug>/<path>` strings.
 */
async function patchedFiles() {
  const out = []
  for (const slug of slugs) {
    const path = join(root, 'src-patches', slug, lock.version + '-better-tasks.patch')
    if (!existsSync(path)) continue
    const text = await readFile(path, 'utf8')
    for (const match of text.matchAll(/^\+\+\+ "?b\/([^"\n]+)/gm)) {
      const rel = match[1].replace(/\\\\/g, '/')
      out.push(slug + '/' + rel.slice(('packages/client/' + slug + '/src/').length))
    }
  }
  return out.sort()
}

test('every patched upstream file carries a documented exception', async () => {
  const doc = await readFile(join(root, 'docs', 'fork-layers.md'), 'utf8')
  const documented = new Set(
    [...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1].replace(/\\/g, '/')),
  )
  for (const file of await patchedFiles()) {
    assert.ok(
      documented.has(file),
      file + ' still carries a patch hunk but has no row in docs/fork-layers.md — add the reason or move it to src-overlay/',
    )
  }
})

test('the exception list has no stale rows', async () => {
  const doc = await readFile(join(root, 'docs', 'fork-layers.md'), 'utf8')
  const documented = [...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1].replace(/\\/g, '/'))
  const actual = new Set(await patchedFiles())
  for (const file of documented) {
    assert.ok(actual.has(file), 'docs/fork-layers.md documents ' + file + ' but it no longer carries a patch')
  }
})

test('the upgrade manual describes the forward route, not a merge route', async () => {
  const doc = await readFile(join(root, 'docs', 'upgrading-dsh-version.md'), 'utf8')
  // The route is: contract report -> build -> gate -> package. A manual that lost
  // the contract step would send the next maintainer straight to a merge again.
  assert.match(doc, /check:contract/)
  assert.match(doc, /src-overlay/)
  assert.match(doc, /layer-split-startup-gate\.ps1/)
  assert.match(doc, /VERDICT: attachable/)
  // The old route's most dangerous step must stay documented, because a green CLI
  // check is still a false green.
  assert.match(doc, /desktop-probe\.ps1/)
})
