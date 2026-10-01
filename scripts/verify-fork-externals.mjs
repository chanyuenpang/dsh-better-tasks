// Compare a fork's runtime module edges against the pinned official artifact.
// An unresolved import can become a warning plus an external require() which the
// Client module table cannot answer. Check the delivered bytes, not only logs.
//
// Usage (offline; all three forks are required unless slugs are explicitly named):
//   node scripts/verify-fork-externals.mjs [ui-workspace] [--json]
//   node scripts/verify-fork-externals.mjs --fork-dir <dir> --official <dir>
// Both overrides use <dir>/<slug>/lib/client.js. Extract tarballs into that layout
// to validate release bytes rather than the mutable staged build directory.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FORK_SLUGS = Object.freeze(['ui-layout', 'ui-workspace', 'ui-user-questions'])
export const INPUT_FORK_SLUGS = Object.freeze(['ui-input-trigger', 'ui-commands', 'ui-conversation'])
const KNOWN_FORK_SLUGS = [...FORK_SLUGS, ...INPUT_FORK_SLUGS]
let typescript

// Reuse the source-build toolchain, without adding a second parser dependency.
// Load lazily: importing this module must not run a CLI, stage sources, read a
// provenance lock, install anything, or exit the caller's process.
function parser() {
  if (typescript !== undefined) return typescript
  for (const from of [import.meta.url, join(root, '.srcbuild', 'package.json')]) {
    try {
      typescript = createRequire(from)('typescript')
      return typescript
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error('Fork external verification needs the existing TypeScript source-build toolchain; stage/install it first. No regex fallback is permitted.')
}

/**
 * Return sorted bare runtime imports, without matching comments or string text.
 * Includes static imports (also side-effect-only imports), re-exports, dynamic
 * import(), require(), and the Client loader's require.async(). Computed requests
 * cannot be verified statically and fail closed instead of silently disappearing.
 */
export function bareSpecifiers(code) {
  const ts = parser()
  const source = ts.createSourceFile('client.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (source.parseDiagnostics.length > 0) {
    const diagnostic = source.parseDiagnostics[0]
    throw new Error(`Cannot parse client bundle: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
  }
  const found = new Set()
  const record = (node) => {
    if (node === undefined || (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node))) {
      throw new Error('Cannot statically verify a non-literal runtime module request')
    }
    const specifier = node.text
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('\0')) return
    // URLs and node: ids are not bare package specifiers.
    if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return
    found.add(specifier)
  }
  const isRequire = (node) => ts.isIdentifier(node) && node.text === 'require'
  const isAsyncRequire = (node) => (
    ts.isPropertyAccessExpression(node) && isRequire(node.expression) && node.name.text === 'async'
  ) || (
    ts.isElementAccessExpression(node) && isRequire(node.expression)
    && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'async'
  )
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) record(node.moduleSpecifier)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword || isRequire(callee) || isAsyncRequire(callee)) {
        record(node.arguments[0])
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...found].sort()
}

/** Pure comparison over bundle text; safe for build and test callers to import. */
export function compareModuleEdges(fork, official) {
  const forkSpecifiers = bareSpecifiers(fork)
  const officialSpecifiers = bareSpecifiers(official)
  const extra = forkSpecifiers.filter(s => !officialSpecifiers.includes(s))
  const missing = officialSpecifiers.filter(s => !forkSpecifiers.includes(s))
  return {
    state: extra.length === 0 && missing.length === 0 ? 'PASS' : 'FAIL',
    forkBytes: Buffer.byteLength(fork),
    officialBytes: Buffer.byteLength(official),
    forkSha: createHash('sha256').update(fork).digest('hex'),
    officialSpecifiers,
    forkSpecifiers,
    extra,
    missing,
  }
}

/** Any unresolved-import warning is fatal, regardless of log wording or quoting. */
export function assertResolvedBuildLog(log, label = 'fork build') {
  if (log.includes('UNRESOLVED_IMPORT')) {
    throw new Error(`${label}: UNRESOLVED_IMPORT; refusing to publish a possibly externalized dependency. Fix the source-build dependencies/paths.\n${log}`)
  }
}

function versionFromLock() {
  return JSON.parse(readFileSync(join(root, 'provenance', 'source.lock.json'), 'utf8')).version
}

function validateSlugs(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) throw new Error('At least one fork slug is required')
  for (const slug of slugs) {
    if (!KNOWN_FORK_SLUGS.includes(slug)) throw new Error(`Unknown fork slug: ${slug}`)
  }
  if (new Set(slugs).size !== slugs.length) throw new Error('Duplicate fork slugs are not allowed')
}

function officialBundle(slug, { version, officialDir }) {
  const path = officialDir === undefined
    ? join(root, 'third_party', slug, version ?? versionFromLock(), 'package', 'lib', 'client.js')
    : join(resolve(officialDir), slug, 'lib', 'client.js')
  // No network/cache fallback: a missing pinned baseline must not silently turn
  // verification into an install or compare against an unverified cached build.
  return readFileSync(path, 'utf8')
}

/** Assert one built bundle before the build writes it into the release staging tree. */
export function assertForkExternals(slug, fork, options = {}) {
  validateSlugs([slug])
  const result = { slug, ...compareModuleEdges(fork, officialBundle(slug, options)) }
  if (result.state !== 'PASS') {
    throw new Error(`${slug}: runtime module edges differ from official; extra: ${result.extra.join(', ') || '(none)'}; missing: ${result.missing.join(', ') || '(none)'}`)
  }
  return result
}

/** Verify an explicit extracted candidate tree. Missing/unreadable bundles fail. */
export function verifyForkExternals({ forkDir, officialDir, version, slugs = FORK_SLUGS } = {}) {
  validateSlugs(slugs)
  const selectedVersion = version ?? (forkDir === undefined || officialDir === undefined ? versionFromLock() : undefined)
  const candidateDir = forkDir === undefined ? join(root, `forks-${selectedVersion}`) : resolve(forkDir)
  return slugs.map(slug => {
    try {
      const fork = readFileSync(join(candidateDir, slug, 'lib', 'client.js'), 'utf8')
      return { slug, ...compareModuleEdges(fork, officialBundle(slug, { version: selectedVersion, officialDir })) }
    } catch (error) {
      return { slug, state: 'FAIL', detail: error.message }
    }
  })
}

/** Short release-stage API alias; same synchronous fail-closed verification. */
export const verifyForks = verifyForkExternals

export function parseArgs(argv) {
  const options = { asJson: false, slugs: [] }
  const seen = new Set()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json' || arg === '--fork-dir' || arg === '--official') {
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`)
      seen.add(arg)
      if (arg === '--json') {
        options.asJson = true
      } else {
        const value = argv[++i]
        if (value === undefined || value.trim() === '' || value.startsWith('--')) throw new Error(`${arg} requires a directory`)
        options[arg === '--fork-dir' ? 'forkDir' : 'officialDir'] = value
      }
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      options.slugs.push(arg)
    }
  }
  if (options.slugs.length === 0) options.slugs = [...FORK_SLUGS]
  validateSlugs(options.slugs)
  return options
}

/** CLI entry returns an exit code; importing the module does not execute it. */
export function main(argv = process.argv.slice(2)) {
  try {
    const { asJson, ...options } = parseArgs(argv)
    const results = verifyForkExternals(options)
    if (asJson) {
      console.log(JSON.stringify(results, null, 2))
    } else {
      console.log('fork runtime module edges vs pinned official artifacts\n')
      for (const result of results) {
        console.log(`${result.state.padEnd(6)} ${result.slug}`)
        if (result.detail !== undefined) {
          console.log(`       FATAL  ${result.detail}`)
          continue
        }
        console.log(`       ${result.forkBytes} B (sha256 ${result.forkSha}) vs official ${result.officialBytes} B`)
        console.log(`       official requires: ${result.officialSpecifiers.join(', ') || '(none)'}`)
        console.log(`       fork     requires: ${result.forkSpecifiers.join(', ') || '(none)'}`)
        for (const specifier of result.extra) console.log(`       FATAL  unexpected runtime import: ${specifier}`)
        for (const specifier of result.missing) console.log(`       FATAL  missing official runtime import: ${specifier}`)
      }
      const failures = results.filter(result => result.state === 'FAIL')
      console.log(`\nverdict: ${failures.length === 0 ? 'PASS' : 'FAIL'} (${results.length} checked, ${failures.length} failed)`)
    }
    return results.some(result => result.state === 'FAIL') ? 1 : 0
  } catch (error) {
    console.error(`fork external verification failed: ${error.message}`)
    return 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
