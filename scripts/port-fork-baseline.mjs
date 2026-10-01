// Port a recorded fork's reviewable deltas onto a newer upstream baseline.
//
// The fork pipeline keeps one active baseline. When upstream ships a new version the
// deltas recorded under patches/<slug>/<oldVersion>-*.patch must be re-fitted onto the
// new upstream artifacts. This tool does that mechanically and reports, per file and
// per hunk, exactly how much drift it had to absorb -- and fails loudly with the
// surrounding upstream context when a hunk no longer has a home, so the port is a
// reviewed decision rather than a silent guess.
//
// Mapping rules for a recorded patch's `a/` path:
//   a/third_party/<slug>/<oldVersion>/package/<rel>  ->  <rel>
//   a/<rel>                                          ->  <rel>
//
// usage:
//   node scripts/port-fork-baseline.mjs <slug> <fromVersion> <toVersion> [--write] [--fuzz N]
//
// Without --write the result is written under .port-probe/<slug>/ for inspection.

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPatch, parsePatch } from 'diff'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [slug, fromVersion, toVersion] = process.argv.slice(2)
if (!slug || !fromVersion || !toVersion) {
  console.error('usage: node scripts/port-fork-baseline.mjs <slug> <fromVersion> <toVersion> [--write] [--fuzz N]')
  process.exit(2)
}
const write = process.argv.includes('--write')
const fuzzArg = process.argv.indexOf('--fuzz')
const maxFuzz = fuzzArg === -1 ? 3 : Number(process.argv[fuzzArg + 1])

const clean = (value) => value.replace(/^\uFEFF/, '')
const slash = (value) => value.replaceAll('\\', '/')

const fromRoot = resolve(root, 'third_party', slug, fromVersion, 'package')
const toRoot = resolve(root, 'third_party', slug, toVersion, 'package')
const patchDir = resolve(root, 'patches', slug)
const forkRoot = resolve(root, 'forks', slug)
const outRoot = write ? forkRoot : resolve(root, '.port-probe', slug)

/**
 * Classify a recorded patch's `a/` path into the layer it applies to.
 *
 * The 0.1.5 ui-workspace fork was built in two recorded steps -- the published
 * artifact was patched into an "installed" variant, and the fork was then derived
 * from that variant -- so a `current-install.patch` and a `better-tasks.patch`
 * both describe the same target file through different `a/` names. Layers must be
 * replayed in order, threading the working content, or the second layer has
 * nothing to apply to.
 *
 *   0  a/third_party/<slug>/<from>/package/<rel>   pristine upstream artifact
 *   1  a/third_party/<slug>/<from>/installed-client.js   the installed variant
 *   2  a/forks/<slug>/<rel>                        the fork itself
 */
function layerOf(name) {
  const normalized = slash(name).replace(/^[ab]\//, '')
  if (normalized.startsWith(`third_party/${slug}/${fromVersion}/package/`)) return 0
  if (normalized.startsWith('forks/')) return 2
  return 1
}

/** Map any layer's `a/` path onto the upstream-relative package path it targets. */
function upstreamRelative(name) {
  const normalized = slash(name).replace(/^[ab]\//, '')
  const prefixed = `third_party/${slug}/${fromVersion}/package/`
  if (normalized.startsWith(prefixed)) return normalized.slice(prefixed.length)
  if (normalized.startsWith('forks/')) return normalized.slice('forks/'.length)
  // An intermediate layer (installed-client.js) still targets the package's client half.
  const base = normalized.split('/').pop()
  if (base === 'installed-client.js') return 'lib/client.js'
  return normalized
}

/** Can this single hunk be fitted to `source` within `fuzz` context mismatches? */
function hunkFits(source, filePatch, hunk, fuzz) {
  const single = { ...filePatch, hunks: [hunk] }
  return applyPatch(source, single, { fuzzFactor: fuzz }) !== false
}

/** Nearest upstream window to a hunk, for human review when a hunk will not fit. */
function contextWindow(source, hunk, radius = 14) {
  const lines = source.split('\n')
  const first = hunk.lines.find((line) => line.startsWith(' ') || line.startsWith('-'))
  const needle = first === undefined ? '' : first.slice(1)
  const hits = []
  for (let i = 0; i < lines.length && hits.length < 3; i++) {
    if (needle !== '' && lines[i].trim() === needle.trim()) hits.push(i + 1)
  }
  if (hits.length === 0) return null
  const at = hits[0] - 1
  const from = Math.max(0, at - radius)
  const to = Math.min(lines.length, at + radius)
  return lines.slice(from, to).map((line, index) => `${String(from + index + 1).padStart(5)} | ${line}`).join('\n')
}

const patchFiles = (await readdir(patchDir)).filter((name) => name.endsWith('.patch')).sort()
if (patchFiles.length === 0) throw new Error(`no patches recorded for ${slug}`)

// Start from a pristine copy of the new upstream tree so unchanged files stay
// byte-identical by construction.
await rm(outRoot, { recursive: true, force: true })
await mkdir(outRoot, { recursive: true })
await run_cp(toRoot, outRoot)

async function run_cp(from, to) {
  const entries = await readdir(from, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    const source = resolve(entry.parentPath ?? entry.path, entry.name)
    const rel = relative(from, source)
    const target = resolve(to, rel)
    if (entry.isDirectory()) { await mkdir(target, { recursive: true }); continue }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(source))
  }
}

const report = []
let failures = 0
let skipped = 0

// Group every recorded file delta by the target file it edits, keeping its layer,
// so layers can be replayed in order over one working copy.
const byTarget = new Map()
for (const patchName of patchFiles) {
  const patchText = clean(await readFile(resolve(patchDir, patchName), 'utf8'))
  for (const filePatch of parsePatch(patchText)) {
    // The `a/` side names the artifact this delta was recorded against.
    const anchor = filePatch.oldFileName ?? filePatch.newFileName ?? ''
    const rel = upstreamRelative(anchor)
    if (!byTarget.has(rel)) byTarget.set(rel, [])
    byTarget.get(rel).push({ patchName, layer: layerOf(anchor), filePatch })
  }
}

for (const [rel, deltas] of [...byTarget].sort(([a], [b]) => a.localeCompare(b))) {
  const upstreamPath = resolve(toRoot, rel)
  let source
  try {
    source = await readFile(upstreamPath, 'utf8')
  } catch {
    skipped += deltas.length
    report.push(`SKIP ${rel}: not published in ${toVersion} (delta must be dropped by hand if still wanted)`)
    continue
  }

  const ordered = [...deltas].sort((a, b) => a.layer - b.layer || a.patchName.localeCompare(b.patchName))
  let working = source
  let targetFailed = false

  for (const { patchName, filePatch } of ordered) {
    const needed = []
    const failedHunks = []
    for (const hunk of filePatch.hunks) {
      let fittedAt = -1
      for (let fuzz = 0; fuzz <= maxFuzz; fuzz++) {
        if (hunkFits(working, filePatch, hunk, fuzz)) { fittedAt = fuzz; break }
      }
      if (fittedAt === -1) failedHunks.push(hunk)
      else needed.push(fittedAt)
    }

    if (failedHunks.length > 0) {
      failures += failedHunks.length
      targetFailed = true
      report.push(`FAIL ${patchName} -> ${rel}: ${failedHunks.length}/${filePatch.hunks.length} hunks have no home`)
      for (const hunk of failedHunks) {
        report.push(`  --- hunk @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
        report.push(hunk.lines.map((line) => `      ${line}`).join('\n'))
        const window = contextWindow(working, hunk)
        report.push(window === null
          ? '      (no similar upstream region found)'
          : `      nearest upstream region:\n${window}`)
      }
      continue
    }

    const fuzz = Math.max(...needed)
    const applied = applyPatch(working, filePatch, { fuzzFactor: fuzz })
    if (applied === false) {
      failures += 1
      targetFailed = true
      report.push(`FAIL ${patchName} -> ${rel}: hunks fit individually but the whole patch would not apply`)
      continue
    }
    working = applied
    report.push(`OK   ${patchName} -> ${rel}: ${filePatch.hunks.length} hunks applied, max drift ${fuzz}`)
  }

  // A hand-authored fix-up covers what the mechanical port could not fit. It is
  // applied last, so it is always written against the post-port text.
  const fixupPath = resolve(patchDir, `${toVersion}-port-fixup.patch`)
  try {
    const fixupText = clean(await readFile(fixupPath, 'utf8'))
    const fixup = parsePatch(fixupText).find((p) => upstreamRelative(p.oldFileName ?? '') === rel)
    if (fixup !== undefined) {
      const applied = applyPatch(working, fixup, { fuzzFactor: 0 })
      if (applied === false) {
        failures += 1
        report.push(`FAIL ${toVersion}-port-fixup.patch -> ${rel}: fix-up no longer applies cleanly`)
      } else {
        working = applied
        report.push(`OK   ${toVersion}-port-fixup.patch -> ${rel}: ${fixup.hunks.length} fix-up hunks applied`)
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  if (!targetFailed || working !== source) {
    await mkdir(dirname(resolve(outRoot, rel)), { recursive: true })
    await writeFile(resolve(outRoot, rel), working, 'utf8')
  }
}

console.log(report.join('\n'))
console.log(`\n${slug} ${fromVersion} -> ${toVersion}: ${failures} unresolved hunks, ${skipped} deltas skipped`)
console.log(`output: ${outRoot}`)
process.exit(failures === 0 ? 0 : 1)
