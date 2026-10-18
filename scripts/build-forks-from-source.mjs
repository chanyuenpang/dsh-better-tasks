// Build the client-UI forks from the pinned upstream source tag.
//
// Why source and not the published lib/client.js: the npm tarballs ship only built
// `lib/` (the `"./src/*"` export maps to files that are not published), so patching
// built JS is the only option when no source is available. The tag is available, so
// the fork is a real source fork: reviewed `src/` deltas on top of a pinned tag,
// built through the unmodified official tsdown preset.
//
// The build root is deliberately standalone. The official preset's node half needs a
// workspace-wide `tsc -b` project graph, which the fork does not change. With
// DSH_BUILD_FACE unset the preset's client entry is `src/client/index.ts`, so a
// client-only build goes straight from TSX to the browser artifact and needs only the
// preset plus the four monorepo-internal modules it imports.
//
// Verified: building an UNMODIFIED 0.2.0-rc.2 ui-layout this way reproduces the
// published npm artifact exactly, up to seed-derived CSS class hashes and build-path
// region comments (see scripts/compare-client-bundles.mjs).
//
// usage:
//   node scripts/build-forks-from-source.mjs --stage          # (re)create .srcbuild from the tag
//   node scripts/build-forks-from-source.mjs --build          # build every slug that has a src patch
//   node scripts/build-forks-from-source.mjs --emit-patch ui-layout
//   node scripts/build-forks-from-source.mjs --source <extracted-tag-dir> ...

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { applyPatch, createTwoFilesPatch, parsePatch } from 'diff'
import { assertForkExternals, assertResolvedBuildLog } from './verify-fork-externals.mjs'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildRoot = join(root, '.srcbuild')
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

const sourceLockPath = join(root, 'provenance', 'source.lock.json')
const lock = JSON.parse(await readFile(sourceLockPath, 'utf8'))
const tag = lock.tag
const commit = lock.commit

const flag = (name) => process.argv.includes(`--${name}`)
const valueOf = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const sourceRoot = await resolveSourceRoot()
if (sourceRoot === null) {
  throw new Error(
    `upstream source tree unavailable. Vendor the pinned tarball at `
    + `third_party/source/${tag}.tar.gz (sha256 ${lock.tarballSha256}), or pass `
    + `--source <extracted tag dir>.`,
  )
}

/**
 * Locate the pinned tag source tree.
 *
 * The vendored tarball is the pinned artifact, so it is verified and extracted into a
 * temp cache rather than committed as an expanded tree.
 * @returns the extracted repository root, or null when neither source is available.
 */
async function resolveSourceRoot() {
  const explicit = valueOf('source', null)
  if (explicit !== null) {
    if (!existsSync(explicit)) throw new Error(`--source does not exist: ${explicit}`)
    return explicit
  }
  const tarball = join(root, 'third_party', 'source', `${tag}.tar.gz`)
  if (!existsSync(tarball)) return null
  const digest = createHash('sha256').update(await readFile(tarball)).digest('hex')
  if (digest !== lock.tarballSha256) {
    throw new Error(`vendored source tarball sha256 mismatch: expected ${lock.tarballSha256}, got ${digest}`)
  }
  const cache = join(tmpdir(), `dsh-src-${tag}`)
  const repoRoot = join(cache, `deepseek-harness-${tag}`)
  if (!existsSync(repoRoot)) {
    console.log(`extracting ${tag} source to ${cache}`)
    await mkdir(cache, { recursive: true })
    await run('tar', ['-xzf', tarball, '-C', cache])
  }
  return repoRoot
}

const clean = (value) => value.replace(/^\uFEFF/, '')
const slash = (value) => value.replaceAll('\\', '/')
const filesBelow = async (dir) => {
  const out = []
  const walk = async (at) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const child = join(at, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) out.push(child)
    }
  }
  await walk(dir)
  return out
}

// ---------------------------------------------------------------- stage

async function stage() {
  // Keep node_modules: re-staging is a routine step and the toolchain install is slow.
  await rm(join(buildRoot, 'packages'), { recursive: true, force: true })
  await rm(join(buildRoot, 'scripts'), { recursive: true, force: true })
  await mkdir(join(buildRoot, 'packages', 'client', 'modules', 'src', 'client'), { recursive: true })
  await mkdir(join(buildRoot, 'packages', 'client', 'web', 'src'), { recursive: true })
  await mkdir(join(buildRoot, 'scripts'), { recursive: true })

  // The official preset and the four monorepo-internal modules it imports.
  await cp(join(sourceRoot, 'packages', 'client', 'tsdown.client.ts'), join(buildRoot, 'packages', 'client', 'tsdown.client.ts'))
  await cp(join(sourceRoot, 'scripts', 'client-build-environment.ts'), join(buildRoot, 'scripts', 'client-build-environment.ts'))
  await cp(join(sourceRoot, 'scripts', 'bundle-input-isolation.ts'), join(buildRoot, 'scripts', 'bundle-input-isolation.ts'))
  // 0.2.1-rc.2: the client preset also imports the experimental-package policy (it decides
  // whether a package name is exempt from the experimental banner). Staging without it leaves
  // tsdown unable to load its config at all.
  if (existsSync(join(sourceRoot, 'scripts', 'experimental-package-policy.ts'))) {
    await cp(join(sourceRoot, 'scripts', 'experimental-package-policy.ts'), join(buildRoot, 'scripts', 'experimental-package-policy.ts'))
  }
  await cp(join(sourceRoot, 'packages', 'client', 'modules', 'src', 'client'), join(buildRoot, 'packages', 'client', 'modules', 'src', 'client'), { recursive: true })
  await cp(join(sourceRoot, 'packages', 'client', 'web', 'src', 'platform.ts'), join(buildRoot, 'packages', 'client', 'web', 'src', 'platform.ts'))
  for (const name of await readdir(sourceRoot)) {
    if (/^tsconfig.*\.json$/.test(name)) await cp(join(sourceRoot, name), join(buildRoot, name))
  }

  // The preset keeps only platform modules and `dsh.client.external` external; every
  // other bare import is resolved and INLINED. So the build root must be able to
  // resolve all of them, exactly as the monorepo can. Two gaps made that fail here,
  // and rolldown turned each into an external require() the runtime cannot answer:
  //
  //   1. third-party libraries (clsx) — the monorepo resolves them from its install;
  //      the standalone root declares only its toolchain, so they were absent.
  //   2. inline-safe @deepseek-ai wire layers (util-workspace-path,
  //      api-workspace-controller/default-workspace, ...) — the monorepo resolves
  //      them through the root tsconfig `paths` into the real source tree, but the
  //      standalone root carries only three of the hundreds of packages those
  //      entries point at.
  //
  // Fix 1: install the client packages' own third-party dependencies.
  const toolchain = { ...lock.buildToolchain }
  const alreadyPinned = new Set(Object.keys(toolchain))
  for (const slug of slugs) {
    const manifest = JSON.parse(await readFile(join(sourceRoot, 'packages', 'client', slug, 'package.json'), 'utf8'))
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        // @deepseek-ai layers come from the tag source (fix 2); @types come from the
        // toolchain. Adding either from the registry would shadow the pinned pair.
        if (name.startsWith('@deepseek-ai/') || name.startsWith('@types/')) continue
        if (alreadyPinned.has(name)) continue
        alreadyPinned.add(name)
        toolchain[name] = range
      }
    }
  }

  // Fix 2: repoint the copied `paths` at the extracted tag source. Rewriting the
  // values is equivalent to the monorepo layout without copying hundreds of
  // packages, and every `--build` re-derives it from the vendored tarball.
  // Textual rather than JSON: the root configs are JSONC and carry comments, and a
  // reserialize would drop them (and the file's own explanatory header).
  for (const name of await readdir(buildRoot)) {
    if (!/^tsconfig.*\.json$/.test(name)) continue
    const configPath = join(buildRoot, name)
    const text = await readFile(configPath, 'utf8')
    if (!text.includes('./packages/')) continue
    await writeFile(configPath, text.replace(/(["'])\.\/packages\//g, (_m, quote) => `${quote}${slash(sourceRoot)}/packages/`))
  }

  for (const slug of slugs) {
    await cp(join(sourceRoot, 'packages', 'client', slug), join(buildRoot, 'packages', 'client', slug), { recursive: true })
    await rm(join(buildRoot, 'packages', 'client', slug, 'tests'), { recursive: true, force: true })
    // Project references describe the workspace `tsc -b` graph; a client-only rolldown
    // build resolves types through the preset, and rolldown aborts on a dangling ref.
    const configPath = join(buildRoot, 'packages', 'client', slug, 'tsconfig.json')
    let config = JSON.parse(await readFile(configPath, 'utf8'))
    if (!config.extends && config.files?.length === 0 && existsSync(join(buildRoot, 'packages', 'client', slug, 'tsconfig.client.json'))) {
      config = JSON.parse(await readFile(join(buildRoot, 'packages', 'client', slug, 'tsconfig.client.json'), 'utf8'))
    }
    delete config.references
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    // Client-only face: the official preset verbatim, minus the node half.
    // 0.2.1-rc.2 changed clientBundle's first argument from the package NAME to the package
    // DIRECTORY (it now reads `<dir>/package.json` itself), so the generated config passes
    // import.meta.dirname and keeps the node-half filter on the same package name.
    await writeFile(join(buildRoot, 'packages', 'client', slug, 'tsdown.build.ts'), `// Generated by scripts/build-forks-from-source.mjs -- do not edit.
import { clientBundle } from '../tsdown.client.ts'

const base = clientBundle(import.meta.dirname, ['lib/types/index.js'])

export default (inlineConfig) => base(inlineConfig).filter((config) => config.name !== ${JSON.stringify(`@deepseek-ai/dsh-client-${slug}`)})
`)
  }

  const manifest = {
    name: 'dsh-client-ui-fork-srcbuild',
    private: true,
    type: 'module',
    version: lock.version,
    description: 'Generated standalone source-build root for the better-tasks client UI forks.',
    devDependencies: toolchain,
  }
  await writeFile(join(buildRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`staged ${tag} source at .srcbuild (${slugs.length} packages)`)
  // Reinstall whenever the declared set changes. The install used to be gated on
  // "tsdown is present", so a dependency added later stayed missing while the build
  // kept succeeding with an external require() nobody serves.
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest.devDependencies)).digest('hex')
  const marker = join(buildRoot, 'node_modules', '.dsh-fork-deps')
  const installed = existsSync(marker) ? (await readFile(marker, 'utf8')).trim() : null
  if (installed !== fingerprint) {
    console.log(installed === null ? 'installing build toolchain...' : 'build dependencies changed; reinstalling...')
    await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: buildRoot, shell: true })
    await writeFile(marker, fingerprint)
  }
}

// ---------------------------------------------------------------- patches

const patchDirFor = (slug) => join(root, 'src-patches', slug)
async function recordedPatch(slug) {
  const dir = patchDirFor(slug)
  if (!existsSync(dir)) return null
  const names = (await readdir(dir)).filter((n) => n.endsWith('.patch')).sort()
  return names.length === 0 ? null : names.map((n) => join(dir, n))
}

async function applyRecordedPatches(slug) {
  const paths = await recordedPatch(slug)
  if (paths === null) return false
  const packageRoot = join(buildRoot, 'packages', 'client', slug)
  for (const patchPath of paths) {
    for (const filePatch of parsePatch(clean(await readFile(patchPath, 'utf8')))) {
      const rel = slash(filePatch.newFileName ?? '').replace(/^[ab]\//, '')
      if (!rel.startsWith(`packages/client/${slug}/`)) {
        throw new Error(`${slash(patchPath)} targets ${rel}, outside packages/client/${slug}/`)
      }
      const target = join(packageRoot, rel.slice(`packages/client/${slug}/`.length))
      // A creation patch has no target on disk yet; treat a missing file as empty.
      let before = ''
      try {
        before = await readFile(target, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const next = applyPatch(before, filePatch)
      if (next === false) throw new Error(`${patchPath} no longer applies: ${rel}`)
      await writeFile(target, next)
    }
  }
  return true
}

async function emitPatch(slug) {
  const pristine = join(sourceRoot, 'packages', 'client', slug)
  const forked = join(buildRoot, 'packages', 'client', slug)
  const pristineFiles = await filesBelow(join(pristine, 'src'))
  const parts = []
  const seen = new Set()
  for (const file of pristineFiles) {
    const rel = slash(relative(pristine, file))
    seen.add(rel)
    const before = await readFile(file, 'utf8')
    const after = await readFile(join(forked, rel), 'utf8')
    if (before === after) continue
    parts.push(createTwoFilesPatch(
      `a/packages/client/${slug}/${rel}`,
      `b/packages/client/${slug}/${rel}`,
      before,
      after,
      '',
      '',
      { context: 3 },
    ))
  }
  // Files the fork ADDS have no pristine twin, so the loop above cannot see them;
  // emit them as creation patches or the staged build loses them entirely.
  for (const file of await filesBelow(join(forked, 'src'))) {
    const rel = slash(relative(forked, file))
    if (seen.has(rel)) continue
    parts.push(createTwoFilesPatch(
      `a/packages/client/${slug}/${rel}`,
      `b/packages/client/${slug}/${rel}`,
      '',
      await readFile(file, 'utf8'),
      '',
      '',
      { context: 3 },
    ))
  }
  if (parts.length === 0) throw new Error(`${slug}: .srcbuild source is identical to the tag; nothing to emit`)
  await mkdir(patchDirFor(slug), { recursive: true })
  const out = join(patchDirFor(slug), `${lock.version}-better-tasks.patch`)
  await writeFile(out, parts.join(''), 'utf8')
  console.log(`emitted ${slash(relative(root, out))} (${parts.length} files, ${(await stat(out)).size} bytes)`)
}

// ---------------------------------------------------------------- build

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/** Replaced per slug with that fork's own source hash; see the stamp below. */
const BUILD_REVISION_PLACEHOLDER = '__BUILD_REVISION__'

async function build() {
  const env = {
    ...process.env,
    DSH_CLIENT_COMMIT_HASH: commit,
    DSH_CLIENT_TITLE: lock.title,
    DSH_CLIENT_BUILD_PROFILE: lock.profile,
    NODE_ENV: 'production',
  }
  const results = []
  for (const slug of slugs) {
    if ((await recordedPatch(slug)) === null) {
      results.push([slug, 'SKIP', 'no src-patches recorded; forks/ left untouched'])
      continue
    }
    await stage_package_check(slug)
    await applyRecordedPatches(slug)
    const tsdown = await run('npx', ['tsdown', '--config', 'tsdown.build.ts'], {
      cwd: join(buildRoot, 'packages', 'client', slug),
      shell: true,
      env,
    })
    // rolldown does NOT fail an unresolvable bare import: tsdown decides the
    // specifier is not external, resolution fails, and rolldown downgrades to an
    // `[UNRESOLVED_IMPORT]` warning while emitting an external `require()` anyway.
    // The runtime has no module-table row for that specifier, so the client plugin
    // fails to instantiate in the browser while every Host-side check still passes.
    // Turn that warning into a build failure.
    const log = `${tsdown.stdout ?? ''}${tsdown.stderr ?? ''}`
    assertResolvedBuildLog(log, slug)
    const built = await readFile(join(buildRoot, 'packages', 'client', slug, 'lib', 'client.js'), 'utf8')
    // Stamp the fork's own build revision into its region-boundary error payload.
    // The browser's localStorage is an append log, so a record only proves which
    // build produced it if it carries that build's revision. Hashed over the staged
    // source, which is deterministic and computable before the artifact exists.
    let stamped = built
    if (stamped.includes(BUILD_REVISION_PLACEHOLDER)) {
      const hash = createHash('sha256')
      const sources = (await filesBelow(join(buildRoot, 'packages', 'client', slug, 'src'))).sort()
      for (const file of sources) hash.update(await readFile(file))
      stamped = stamped.replaceAll(BUILD_REVISION_PLACEHOLDER, hash.digest('hex'))
      if (stamped.includes(BUILD_REVISION_PLACEHOLDER)) {
        throw new Error(`${slug}: build revision placeholder survived the stamp`)
      }
    }
    // Gate the exact bytes before publishing them to the release staging tree.
    // A warning-format change must never let an unsupported require() slip through.
    assertForkExternals(slug, stamped, { version: lock.version })
    // Staged under forks-<version>/, not forks/: `npm run build:fork` regenerates
    // forks/ from the active baseline's patches, and the active baseline stays on the
    // previous dsh line until every slug has a source patch.
    await mkdir(join(root, `forks-${lock.version}`, slug, 'lib'), { recursive: true })
    await writeFile(join(root, `forks-${lock.version}`, slug, 'lib', 'client.js'), stamped)
    results.push([slug, 'BUILT', `${stamped.length} bytes, sha256 ${sha256(stamped).slice(0, 16)}...`])
  }
  console.log('')
  for (const [slug, state, detail] of results) console.log(`${state.padEnd(6)} ${slug.padEnd(20)} ${detail}`)
}

async function stage_package_check(slug) {
  const dir = join(buildRoot, 'packages', 'client', slug)
  if (!existsSync(dir)) throw new Error(`${slug}: .srcbuild is not staged; run --stage first`)
}

// ---------------------------------------------------------------- main

if (flag('test-source')) {
  // Tests execute the patched TS contracts but do not need to rebuild or mutate
  // accepted fork artifacts. Re-stage only the generated, ignored source tree.
  if (slash(relative(root, resolve(buildRoot, 'packages'))) !== '.srcbuild/packages') {
    throw new Error('Refusing to replace source outside the generated .srcbuild/packages tree')
  }
  if (slash(relative(root, resolve(buildRoot, 'scripts'))) !== '.srcbuild/scripts') {
    throw new Error('Refusing to replace source outside the generated .srcbuild/scripts tree')
  }
  await stage()
  for (const slug of slugs) await applyRecordedPatches(slug)
  console.log('patched test source ready; accepted fork lib artifacts were not rebuilt')
}
if (flag('stage')) await stage()
if (flag('emit-patch')) await emitPatch(valueOf('emit-patch', 'ui-layout'))
if (flag('build')) {
  // Always re-stage: the recorded patches must apply to pristine tag sources, and a
  // previous build already applied them in place.
  await stage()
  await build()
}
if (!flag('stage') && !flag('build') && !flag('emit-patch') && !flag('test-source')) {
  console.log('nothing to do; pass --stage, --test-source, --emit-patch <slug>, or --build')
}
