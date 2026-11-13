// Contract-drift check between two upstream dsh source trees.
//
// The fork is split into two layers:
//   b layer  = pristine upstream source (never edited by us)
//   a layer  = our own files + our registration call sites
//
// Upgrading must therefore be mechanical: forward the tag, then answer one
// question — does the a layer still attach? Answering it by "run the whole build
// and read the stack trace" is too late. This script answers it before anything
// is built, by observing exactly what the a layer touches:
//
//   1. upstream internal modules our overlay/new files import (existence, byte
//      equality, exported symbol delta)
//   2. the public extension surface we attach to (slot declarations, service
//      faces, client manifest fields)
//   3. which of our files each drift item puts at risk
//
// It deliberately does NOT diff the whole repository: a change to a package we
// never touch is not our problem.
//
// The comparison only means something in the upgrade direction: --from must be
// the tag our a layer was written against (provenance/source.lock.json), and --to
// the tag we are forwardng to. Whole-module takeovers pin their imports to the
// --from version, so running the check backwards reports the drift we already
// absorbed as if it were new — the run prints a warning when that is the case.
//
// usage:
//   node scripts/check-upstream-contract.mjs --from <src tree> --to <src tree> [--json <out>]
//   node scripts/check-upstream-contract.mjs --from-tag <version> --to-tag <version>
//
// Exit code: 0 when the a layer stays attachable, 1 when an incompatible drift
// exists, 2 on a usage error.
//
// Tested by test/upstream-contract.test.mjs, which pins the two failure modes
// that matter: a false BROKEN (costs a day of pointless rework) and a missed
// BROKEN (ships a fork whose imports no longer resolve).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

const argv = process.argv.slice(2)
const valueOf = (name, fallback = null) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}

// ------------------------------------------------------------------ sources

/**
 * Resolve a source tree for one upstream version, extracting the vendored
 * tarball when the tree is not already unpacked. Extraction is cached in the OS
 * temp dir so repeated checks do not re-unpack 30 MB.
 * @param version - upstream version string, e.g. 0.2.2-rc.1.
 * @returns absolute path to the extracted repository root.
 */
async function sourceTreeFor(version) {
  const tag = 'dsh-v' + version
  const cache = join(process.env.TEMP ?? '/tmp', 'dsh-src-' + tag)
  const repoRoot = join(cache, 'deepseek-harness-' + tag)
  if (existsSync(repoRoot)) return repoRoot
  const tarball = join(root, 'third_party', 'source', tag + '.tar.gz')
  if (!existsSync(tarball)) {
    throw new Error('neither an extracted tree nor a vendored tarball exists for ' + version)
  }
  await mkdir(cache, { recursive: true })
  console.log('extracting ' + tag + ' source to ' + cache)
  await run('tar', ['-xzf', tarball, '-C', cache])
  return repoRoot
}

// ------------------------------------------------------------------ helpers

const slash = (value) => value.replaceAll('\\', '/').replace(/\/{2,}/g, '/')

/**
 * List every file below a directory.
 * @param dir - directory to walk.
 * @returns absolute paths (empty when the directory is absent).
 */
async function filesBelow(dir) {
  const out = []
  const walk = async (at) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const child = join(at, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) out.push(child)
    }
  }
  if (existsSync(dir)) await walk(dir)
  return out
}

/**
 * Resolve a module specifier to a real file, trying the extensions and index
 * forms the client packages use.
 * @param base - absolute path without a known extension.
 * @returns the existing file, or null.
 */
function resolveModule(base) {
  const candidates = [
    base,
    base.replace(/\.(tsx?|jsx?)$/, '.ts'),
    base.replace(/\.(tsx?|jsx?)$/, '.tsx'),
    base.replace(/\.(tsx?|jsx?)$/, '.css'),
    base + '.ts',
    base + '.tsx',
    base + '.css',
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Extract a module's exported symbol names textually.
 *
 * The check only needs "did this name appear or disappear", and the repository
 * does not expose TypeScript's API to a plain script, so a tolerant textual scan
 * is the right tool: it must never fail on syntax it does not fully understand.
 * @param text - module source.
 * @returns sorted export names.
 */
export function exportedNames(text) {
  const names = new Set()
  const collect = (value) => {
    for (const part of value.split(',')) {
      const cleaned = part.trim().replace(/^type\s+/, '')
      if (cleaned === '' || cleaned.startsWith('*')) continue
      const [left, right] = cleaned.split(/\s+as\s+/)
      const name = (right ?? left).trim().split(/\s+/).pop()
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  for (const match of text.matchAll(/^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(match[1])
  }
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) collect(match[1])
  // A star re-export's members are not textually knowable; treating them as
  // unknown is safer than inventing a diff.
  names.delete('default')
  return [...names].sort()
}

// ------------------------------------------------------- a-layer inventory

/**
 * Read a recorded patch layer and return the files it creates (the overlay).
 * @param patchText - unified diff text.
 * @returns map of repo-relative path to file body.
 */
export function overlayFilesOf(patchText) {
  const out = new Map()
  for (const chunk of patchText.split(/^=+$/m)) {
    if (!/@@ -0,0 \+/.test(chunk)) continue
    const name = (chunk.match(/^\+\+\+ "?b\/([^"\n]+)/m) ?? [])[1]
    if (name === undefined) continue
    let body = ''
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) body += line.slice(1) + '\n'
    }
    out.set(slash(name), body)
  }
  return out
}

/**
 * Read a recorded patch layer and return the upstream files it edits.
 * @param patchText - unified diff text.
 * @returns repo-relative paths that are modifications (not creations).
 */
export function editedFilesOf(patchText) {
  const out = new Set()
  for (const chunk of patchText.split(/^=+$/m)) {
    if (!/^--- "?a\//m.test(chunk)) continue
    if (/@@ -0,0 \+/.test(chunk)) continue
    const name = (chunk.match(/^\+\+\+ "?b\/([^"\n]+)/m) ?? [])[1]
    if (name !== undefined) out.add(slash(name))
  }
  return out
}

const activeLock = JSON.parse(await readFile(join(root, 'provenance', 'source.lock.json'), 'utf8'))
// --version selects which registered line's a layer is inspected. Without it the
// check looks at the active (default) line, exactly as before.
const lock = {
  ...activeLock,
  version: valueOf('version', activeLock.version) ?? activeLock.version,
}

/**
 * Which overlay root this run should read for one slug.
 *
 * A slug may carry per-line overlays: the flat src-overlay/<slug>/ tree is the
 * default, and src-overlay/<slug>/<variant>/ holds a line-specific rewrite of the
 * same files. A variant directory is a sibling of `client/`, so it must be excluded
 * when the flat tree is scanned — otherwise its files reappear as bogus
 * `src/<variant>/...` sources.
 * @param slug - fork package name.
 * @returns the directory to scan plus the child directories to skip under it.
 */
function overlayRootFor(slug) {
  const flat = join(root, 'src-overlay', slug)
  let registry = null
  try {
    registry = JSON.parse(readFileSync(join(root, 'provenance', 'versions.json'), 'utf8'))
  } catch {
    registry = null
  }
  const variant = registry?.versions?.[lock.version]?.overlayVariant ?? 'default'
  const variantDir = join(flat, variant)
  if (variant !== 'default' && existsSync(variantDir)) return { dir: variantDir, exclude: [] }
  // Flat scan: every registered variant directory is a sibling, never a source child.
  const exclude = Object.values(registry?.versions ?? {})
    .map((entry) => entry?.overlayVariant)
    .filter((name) => typeof name === 'string' && name !== 'default')
  return { dir: existsSync(flat) ? flat : null, exclude }
}

/**
 * Build the a-layer inventory from the fork library on disk.
 *
 * Overlay files are read from the line's overlay root when that directory exists;
 * otherwise they fall back to the creation hunks of the recorded patch, so the
 * checker works both before and after overlay formalisation.
 * @returns one entry per a-layer file.
 */
async function aLayerInventory() {
  const inventory = []
  for (const slug of slugs) {
    const { dir: overlayDir, exclude } = overlayRootFor(slug)
    const patchPath = join(root, 'src-patches', slug, lock.version + '-better-tasks.patch')
    const files = new Map()
    if (overlayDir !== null) {
      for (const file of await filesBelow(overlayDir)) {
        const inside = slash(file.slice(overlayDir.length + 1))
        // A sibling variant directory is never part of the default overlay.
        if (exclude.some((name) => inside === name || inside.startsWith(name + '/'))) continue
        files.set('packages/client/' + slug + '/src/' + inside, await readFile(file, 'utf8'))
      }
    } else if (existsSync(patchPath)) {
      for (const [rel, body] of overlayFilesOf(await readFile(patchPath, 'utf8'))) files.set(rel, body)
    }
    for (const [rel, body] of files) inventory.push({ slug, rel, body })
  }
  return inventory
}

/**
 * Collect the upstream modules our a layer imports.
 * @param inventory - a-layer files.
 * @returns list of { slug, ours, specifier, path }.
 */
function upstreamImports(inventory) {
  const out = []
  for (const { slug, rel, body } of inventory) {
    // Repo-relative importer path; the importer's own directory is where a
    // relative specifier resolves from, so resolve against the repository root.
    const importerDir = dirname(rel)
    for (const match of body.matchAll(/import\s+([\s\S]*?)\s*from\s+'(\.[^']+)'/g)) {
      const specifier = match[2]
      const path = slash(relative('/', resolve('/', importerDir, specifier)))
      out.push({ slug, ours: rel, specifier, path, bindings: importedBindings(match[1]) })
    }
  }
  return out
}

/**
 * Names a module actually binds from one import clause.
 *
 * The drift rule needs the bindings, not just the module: a module can drop an
 * export we never touch, and reporting that as BROKEN would be the exact
 * false-positive this checker exists to prevent. Only default imports bind a name
 * that the export scan cannot see, so they are recorded as `default`.
 * @param clause - the text between `import` and `from`.
 * @returns bound local names (empty for a side-effect or namespace-only import).
 */
function importedBindings(clause) {
  const text = clause.trim()
  if (text === '') return []
  if (text.startsWith('*')) return []
  const names = []
  const braces = text.match(/\{([\s\S]*)\}/)
  if (braces !== null) {
    for (const part of braces[1].split(',')) {
      const cleaned = part.trim().replace(/^type\s+/, '')
      if (cleaned === '') continue
      const [left, right] = cleaned.split(/\s+as\s+/)
      const name = (left ?? '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
      void right
    }
  }
  if (!text.startsWith('{') && !text.startsWith('type {')) {
    const head = text.split(/[\s,{]/)[0]
    if (/^[A-Za-z_$][\w$]*$/.test(head)) names.push('default')
  }
  return names
}

// ---------------------------------------------------- public surface probes

/**
 * Extract every `children: { ... }` object body in a source text.
 *
 * Slot declarations only exist inside a registration's children table. Locating
 * that table's brace span is what separates a real declaration from an ordinary
 * object literal that happens to carry a `kind:` field.
 * @param text - a source file.
 * @returns the inner text of each children table.
 */
function childrenBlocks(text) {
  const blocks = []
  for (const match of text.matchAll(/children\s*:\s*\{/g)) {
    let depth = 1
    let index = (match.index ?? 0) + match[0].length
    const start = index
    while (index < text.length && depth > 0) {
      const char = text[index]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      index += 1
    }
    blocks.push(text.slice(start, index - 1))
  }
  return blocks
}

/**
 * Probe the public extension surface the fork attaches to.
 *
 * These are the places a silent break hurts most: a slot declaration that moves
 * owner, a service method that disappears. Each probe reads source textually so
 * it works on any tag without building it.
 * @param tree - upstream repository root.
 * @returns map of probe name to a comparable value.
 */
async function publicSurface(tree) {
  const clientDir = join(tree, 'packages', 'client')
  const read = async (rel) => {
    const path = join(tree, rel)
    return existsSync(path) ? readFile(path, 'utf8') : null
  }

  // Every declared slot key with its kind, across every client package.
  //
  // The declaration table is a property list nested inside
  // ctx.slots.register({ name, children: { ... } }), so a flat regex hunting
  // "'key': { kind:" also matches ordinary object literals and invents slots that
  // do not exist. Parse the children table's brace span instead.
  const slots = new Map()
  for (const entry of existsSync(clientDir) ? await readdir(clientDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue
    for (const file of await filesBelow(join(clientDir, entry.name, 'src'))) {
      if (!/\.tsx?$/.test(file)) continue
      const text = await readFile(file, 'utf8')
      for (const block of childrenBlocks(text)) {
        for (const match of block.matchAll(/([A-Za-z][\w.]*)\s*:\s*\{\s*kind:\s*'(single|keyed|list|chain)'/g)) {
          slots.set(match[1], match[2])
        }
      }
    }
  }

  // The layout service face our sidebar-width persistence reaches through.
  const layoutService = await read(join('packages', 'client', 'ui-layout', 'src', 'client', 'service.ts'))
  const layoutMethods = layoutService === null
    ? []
    : [...layoutService.matchAll(/^\s{2}([a-zA-Z][\w]*)\(/gm)].map((m) => m[1]).sort()

  // The client manifest fields a fork package declares.
  const manifest = await read(join('packages', 'client', 'modules', 'src', 'client', 'manifest.ts'))
  const manifestFields = manifest === null
    ? []
    : [...new Set([...manifest.matchAll(/dsh\.client\.([\w.]+)/g)].map((m) => m[1]))].sort()

  // The sessions face our pin lifecycle observes.
  const sessions = await read(join('packages', 'api', 'session-controller', 'src', 'client', 'contract', 'sessions.ts'))
  const sessionsMembers = sessions === null
    ? []
    : [...new Set([...sessions.matchAll(/^\s{2}(?:readonly\s+)?([a-zA-Z][\w]*)[?:(]/gm)].map((m) => m[1]))].sort()

  return { slots, layoutMethods, manifestFields, sessionsMembers }
}

// ------------------------------------------------------------------- report

const NO_DRIFT = 'unchanged'
const COMPATIBLE = 'compatible'
const BROKEN = 'incompatible'

/**
 * Compare two source trees and build the drift report.
 * @param from - old upstream repository root.
 * @param to - new upstream repository root.
 * @returns structured report.
 */
export async function compare(from, to, inventory = null) {
  const aLayer = inventory ?? await aLayerInventory()
  // The a layer is written against the pinned tag. Comparing it with anything
  // other than that tag as "from" reports absorbed drift as new drift, so say so
  // instead of letting the verdict be read at face value.
  const fromVersion = /deepseek-harness-dsh-v(.+)$/.exec(slash(from))?.[1]
  if (fromVersion !== undefined && fromVersion !== lock.version) {
    console.warn(
      'warning: --from tree is ' + fromVersion + ' but the a layer is pinned to ' + lock.version
      + '; expect false drift in the direction of absorbed changes.',
    )
  }
  // Our own files are not upstream modules: an import between two a-layer files
  // says nothing about whether the next tag still suits us.
  const ownLayer = new Set(aLayer.map((entry) => entry.rel))
  const imports = upstreamImports(aLayer).filter((item) => !ownLayer.has(item.path))

  const modules = new Map()
  for (const item of imports) {
    const key = item.path
    const existing = modules.get(key)
    if (existing !== undefined) {
      if (!existing.importers.includes(item.ours)) existing.importers.push(item.ours)
      for (const name of item.bindings) existing.bindings.add(name)
      continue
    }
    const fromPath = resolveModule(join(from, key))
    const toPath = resolveModule(join(to, key))
    const entry = {
      path: key, status: NO_DRIFT, importers: [item.ours],
      bindings: new Set(item.bindings), removedExports: [], addedExports: [],
    }
    if (toPath === null) {
      entry.status = BROKEN
    } else if (fromPath === null) {
      // A brand new upstream file: our import still resolves.
      entry.status = COMPATIBLE
    } else {
      const before = await readFile(fromPath, 'utf8')
      const after = await readFile(toPath, 'utf8')
      if (before !== after) {
        entry.status = COMPATIBLE
        const beforeNames = new Set(exportedNames(before))
        const afterNames = new Set(exportedNames(after))
        entry.addedExports = [...afterNames].filter((name) => !beforeNames.has(name)).sort()
        // Only names we actually bind may break us. A module dropping an export we
        // never import is a fact about its API, not about our layer.
        entry.removedExports = [...beforeNames]
          .filter((name) => !afterNames.has(name) && entry.bindings.has(name))
          .sort()
        entry.unusedRemovals = [...beforeNames]
          .filter((name) => !afterNames.has(name) && !entry.bindings.has(name))
          .sort()
        if (entry.removedExports.length > 0) entry.status = BROKEN
      }
    }
    modules.set(key, entry)
  }

  const before = await publicSurface(from)
  const after = await publicSurface(to)
  const surface = []
  const probe = (name, oldValue, newValue) => {
    const oldSet = oldValue instanceof Map ? new Set(oldValue.keys()) : new Set(oldValue)
    const newSet = newValue instanceof Map ? new Set(newValue.keys()) : new Set(newValue)
    const removed = [...oldSet].filter((key) => !newSet.has(key)).sort()
    const added = [...newSet].filter((key) => !oldSet.has(key)).sort()
    const kindChanged = oldValue instanceof Map
      ? [...oldSet].filter((key) => newValue.has(key) && oldValue.get(key) !== newValue.get(key)).sort()
      : []
    const status = removed.length > 0 || kindChanged.length > 0 ? BROKEN : added.length > 0 ? COMPATIBLE : NO_DRIFT
    surface.push({ name, status, removed, added, kindChanged })
  }
  probe('slot declarations', before.slots, after.slots)
  probe('layout service methods', before.layoutMethods, after.layoutMethods)
  probe('client manifest fields', before.manifestFields, after.manifestFields)
  probe('sessions contract members', before.sessionsMembers, after.sessionsMembers)

  // Whole-module takeovers: an a-layer file that shadows an upstream module of the
  // same path. Forwarding never conflicts here — upstream's file stays pristine —
  // but that is exactly why the loss would be silent: upstream's improvements to
  // that module stop reaching us. Surface it as work, not as a failure.
  const takeovers = []
  for (const entry of aLayer) {
    const upstreamPath = resolveModule(join(to, entry.rel))
    if (upstreamPath === null) continue
    const upstreamNow = await readFile(upstreamPath, 'utf8')
    const upstreamBefore = resolveModule(join(from, entry.rel))
    const upstreamWas = upstreamBefore === null ? null : await readFile(upstreamBefore, 'utf8')
    takeovers.push({
      path: entry.rel,
      changedUpstream: upstreamWas !== null && upstreamWas !== upstreamNow,
      upstreamBytes: upstreamNow.length,
      oursBytes: entry.body.length,
    })
  }

  const broken = [...modules.values()].filter((entry) => entry.status === BROKEN)
  return {
    takeovers: takeovers.sort((a, b) => a.path.localeCompare(b.path)),
    modules: [...modules.values()]
      .map((entry) => ({ ...entry, bindings: [...entry.bindings].sort() }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    surface,
    incompatible: broken.length > 0 || surface.some((entry) => entry.status === BROKEN),
    affectedFiles: [...new Set(broken.flatMap((entry) => entry.importers))].sort(),
  }
}

/**
 * Format the report for a terminal.
 * @param report - compare() result.
 * @param labels - source labels for the header.
 * @returns lines to print.
 */
function render(report, labels) {
  const lines = []
  const counts = { unchanged: 0, compatible: 0, incompatible: 0 }
  for (const entry of report.modules) counts[entry.status] += 1
  lines.push('upstream contract: ' + labels.from + ' -> ' + labels.to)
  lines.push('')
  lines.push('modules the a layer imports: ' + report.modules.length)
  lines.push('  unchanged     : ' + counts.unchanged)
  lines.push('  changed/added : ' + counts.compatible)
  lines.push('  missing       : ' + counts.incompatible)
  if (counts.compatible + counts.incompatible > 0) lines.push('')
  for (const entry of report.modules) {
    if (entry.status === NO_DRIFT) continue
    lines.push('  ' + (entry.status === BROKEN ? 'BROKEN ' : 'CHANGED') + ' ' + entry.path)
    if (entry.removedExports.length > 0) lines.push('      lost exports: ' + entry.removedExports.join(', '))
    if ((entry.unusedRemovals ?? []).length > 0) {
      lines.push('      dropped but unused by us: ' + entry.unusedRemovals.join(', '))
    }
    if (entry.addedExports.length > 0) lines.push('      gained      : ' + entry.addedExports.join(', '))
    lines.push('      used by     : ' + entry.importers.join(', '))
  }
  lines.push('')
  lines.push('public extension surface:')
  for (const entry of report.surface) {
    const tag = entry.status === BROKEN ? 'BROKEN ' : entry.status === COMPATIBLE ? 'CHANGED' : 'ok     '
    lines.push('  ' + tag + ' ' + entry.name)
    if (entry.removed.length > 0) lines.push('      removed     : ' + entry.removed.join(', '))
    if (entry.kindChanged.length > 0) lines.push('      kind changed: ' + entry.kindChanged.join(', '))
    if (entry.added.length > 0 && entry.status !== BROKEN) lines.push('      added       : ' + entry.added.join(', '))
  }
  lines.push('')
  const driftTakeovers = (report.takeovers ?? []).filter((entry) => entry.changedUpstream)
  if ((report.takeovers ?? []).length > 0) {
    lines.push('whole-module takeovers (' + report.takeovers.length + '):')
    for (const entry of report.takeovers) {
      lines.push('  ' + (entry.changedUpstream ? 'REVIEW' : 'ok    ') + ' ' + entry.path)
      if (entry.changedUpstream) {
        lines.push('      upstream changed this module: re-apply our version against the new upstream one')
      }
    }
    if (driftTakeovers.length === 0) lines.push('  (upstream did not change any taken-over module: nothing to re-apply)')
    lines.push('')
  }
  if (report.incompatible) {
    lines.push('VERDICT: incompatible — fix the a layer, never the report.')
    if (report.affectedFiles.length > 0) lines.push('affected a-layer files: ' + report.affectedFiles.join(', '))
  } else {
    lines.push('VERDICT: attachable — forward, build, run the startup gate, package.')
  }
  return lines
}

// --------------------------------------------------------------------- main

/**
 * Run the comparison for two trees.
 *
 * Exported so tests exercise the real code path instead of a reimplementation.
 * @param options - the two trees, plus an optional a-layer inventory override.
 * @returns the drift report.
 */
export async function runCheck({ from, to, inventory = null }) {
  return compare(from, to, inventory)
}

/**
 * Whether this module is the process entry point.
 * @returns true when invoked as a script rather than imported.
 */
function isMain() {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
}

if (isMain()) {
  const fromArg = valueOf('from')
  const toArg = valueOf('to')
  const fromVersion = valueOf('from-tag')
  const toVersion = valueOf('to-tag')

  const fromTree = fromArg ?? (fromVersion === null ? null : await sourceTreeFor(fromVersion))
  const toTree = toArg ?? (toVersion === null ? null : await sourceTreeFor(toVersion))
  if (fromTree === null || toTree === null) {
    console.error('usage: node scripts/check-upstream-contract.mjs --from <dir> --to <dir> [--json <out>]')
    console.error('       node scripts/check-upstream-contract.mjs --from-tag <version> --to-tag <version>')
    process.exit(2)
  }

  const report = await compare(fromTree, toTree)
  for (const line of render(report, { from: fromVersion ?? fromTree, to: toVersion ?? toTree })) console.log(line)

  const jsonOut = valueOf('json')
  if (jsonOut !== null) {
    await mkdir(dirname(resolve(jsonOut)), { recursive: true })
    await writeFile(resolve(jsonOut), JSON.stringify({ from: fromVersion ?? fromTree, to: toVersion ?? toTree, ...report }, null, 2) + '\n')
    console.log('\nreport written to ' + jsonOut)
  }

  process.exit(report.incompatible ? 1 : 0)
}
