// Verify the 0.2.0-rc.2 client-UI forks against the pinned upstream source baseline.
//
// Assertion split — this is deliberate, and it is the lesson from the 0.1.5 scripts:
//
//   * SOURCE-form markers (constant declarations, type/export names) are asserted
//     against `src-patches/<slug>/<version>-better-tasks.patch`. tsdown reflows
//     whitespace, so `export const SIDEBAR_MAX = 840` IS in the patch and is NOT
//     in the built artifact. Asserting it on the artifact produces a false failure.
//   * CROSS-PACKAGE contract strings (the `questionSurface` provider name, the
//     `data-question-surface` router attribute, a consumer-visible member name)
//     are asserted against the built artifact, because that is what a host resolves
//     at runtime.
//
// The baseline version comes from `provenance/source.lock.json`. Nothing here uses
// `installed-client.js` as a byte baseline: the source route has no byte-identical
// published twin (see the fidelity note in that lock file).
//
// usage:
//   node scripts/verify-forks-0.2.0.mjs                  # verify
//   node scripts/verify-forks-0.2.0.mjs --write          # (re)record artifact sha256s
//   node scripts/verify-forks-0.2.0.mjs --require-all    # release gate: every slug ported
//   node scripts/verify-forks-0.2.0.mjs --profile <dir>  # also assert an installed profile

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flag = (name) => process.argv.includes(`--${name}`)
const valueOf = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const sourceLock = JSON.parse(await readFile(join(root, 'provenance', 'source.lock.json'), 'utf8'))
const version = sourceLock.version
const lockPath = join(root, 'provenance', `forks-${version}.lock.json`)

/**
 * Per-slug expectations.
 *
 * `artifact` holds cross-package contract strings a host resolves at runtime.
 * `patch` holds source-form markers that only exist before the bundler reflows them.
 * `children` are the root slot children a downstream sidebar replacement mounts into;
 * losing one of these silently detaches an occupant, which is worse than a missing
 * feature, so they are asserted on the artifact where they are string literals.
 */
const SLUGS = {
  'ui-layout': {
    packageName: '@deepseek-ai/dsh-client-ui-layout',
    artifact: [
      'id: "@deepseek-ai/dsh-client-ui-layout"',
      'ctx.reflect.provide("layout", layout)',
      'dsh-better-tasks.layout.sidebar-width.v1',
      'currentSidebarPreference',
      'sidebarMax',
    ],
    patch: [
      'export const SIDEBAR_MAX = 840',
      'export const SIDEBAR_MIN',
      'sidebarMax',
      'currentSidebarPreference',
    ],
    children: ['"sidebar": {', '"main": {', '"rightbar": {', '"shell.overlay": {'],
  },
  'ui-user-questions': {
    packageName: '@deepseek-ai/dsh-client-ui-user-questions',
    artifact: [
      'id: "@deepseek-ai/dsh-client-ui-user-questions"',
      // The two strings a host such as the Better Tasks task card resolves.
      'ctx.reflect.provide("questionSurface", questionSurface)',
      '"data-question-surface": variant',
      '"task-card"',
      'isSupported',
      'ctx.slots.inject("conversation.composer"',
      'name: "conversation.composer"',
      'ctx.remote.$on("user-questions/request"',
      'ctx.uiSession.registerPendingInteraction(',
      'completed.resolve();',
      'registry.forget',
      'style.remove();',
    ],
    patch: [
      'createQuestionSurfaceDraftStore',
      'class QuestionSurfaceRegistry',
      'beginSettlement',
      'gate.locked',
      'QuestionSurfaceGate',
      // The documented degradation: a renderSlot binding is only authorizable inside
      // the entry that declares it, so a host-mounted seat gets no plan-review action
      // preview. Kept visible here so it cannot be "fixed" into a foreign-entry call.
      'renderSlot: () => null',
    ],
    children: [],
  },
  'ui-workspace': {
    packageName: '@deepseek-ai/dsh-client-ui-workspace',
    // Better Tasks' client half calls these on `ctx.uiWorkspace` WITHOUT optional
    // chaining (src/client.js: ctx.effect(() => ctx.uiWorkspace.onSessionCreated(…)),
    // startSession, openSession, and ctx.inject(['uiWorkspace'], …)). The native
    // 0.2 package has no onSessionCreated, so a native ui-workspace under a
    // Better Tasks sidebar throws and the WHOLE sidebar fails to mount. These are
    // therefore hard acceptance items, not feature markers.
    artifact: [
      'onSessionCreated',
      'startSession',
      'openSession',
      'betterTaskPins',
      'TaskPinIcon',
      'project-appearance',
    ],
    patch: ['onSessionCreated', 'notifySessionCreated', 'sessionCreatedListeners', 'setActivityRange'],
    children: [],
  },
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const failures = []
const notes = []
const fail = (message) => failures.push(message)
const requireContract = (haystack, needle, where, label) => {
  const count = haystack.split(needle).length - 1
  if (count < 1) fail(`${label}: ${where} is missing ${JSON.stringify(needle)}`)
  return count
}
const requireExact = (haystack, needle, expected, where, label) => {
  const count = requireContract(haystack, needle, where, label)
  if (count !== expected) fail(`${label}: ${where} has ${JSON.stringify(needle)} x${count}, expected x${expected}`)
}

const recorded = existsSync(lockPath) ? JSON.parse(await readFile(lockPath, 'utf8')) : { artifacts: {} }
const nextLock = { version, sourceCommit: sourceLock.commit, artifacts: { ...recorded.artifacts } }
const rows = []

for (const [slug, spec] of Object.entries(SLUGS)) {
  const patchPath = join(root, 'src-patches', slug, `${version}-better-tasks.patch`)
  const artifactPath = join(root, `forks-${version}`, slug, 'lib', 'client.js')
  if (!existsSync(patchPath)) {
    rows.push([slug, 'NOT-PORTED', 'no src patch recorded'])
    continue
  }
  if (!existsSync(artifactPath)) {
    fail(`${slug}: src patch exists but forks-${version}/${slug}/lib/client.js is missing — run --build`)
    rows.push([slug, 'FAIL', 'artifact missing'])
    continue
  }

  const artifact = await readFile(artifactPath, 'utf8')
  const patch = await readFile(patchPath, 'utf8')
  const bytes = Buffer.byteLength(artifact, 'utf8')
  const digest = sha256(artifact)

  for (const needle of spec.artifact) requireContract(artifact, needle, 'built artifact', slug)
  for (const needle of spec.patch) requireContract(patch, needle, 'src patch', slug)
  for (const child of spec.children) requireExact(artifact, child, 1, 'built artifact', slug)

  // Package identity, when the fork package has been materialized (release step).
  const forkManifestPath = join(root, `forks-${version}`, slug, 'package.json')
  if (existsSync(forkManifestPath)) {
    const manifest = JSON.parse(await readFile(forkManifestPath, 'utf8'))
    if (manifest.version !== version) fail(`${slug}: fork package version ${manifest.version} != baseline ${version}`)
    if (manifest.dsh?.client?.platform !== 'web') fail(`${slug}: dsh.client.platform must be "web"`)
  } else {
    notes.push(`${slug}: forks-${version}/${slug}/package.json not materialized yet (release step) — identity not asserted`)
  }

  const previous = recorded.artifacts[slug]
  if (previous !== undefined && !flag('write')) {
    if (previous.sha256 !== digest) fail(`${slug}: sha256 ${digest.slice(0, 16)}… != recorded ${String(previous.sha256).slice(0, 16)}… — rebuild is not byte-reproducible`)
    if (previous.bytes !== bytes) fail(`${slug}: ${bytes} bytes != recorded ${previous.bytes}`)
  }
  nextLock.artifacts[slug] = { bytes, sha256: digest }
  rows.push([slug, 'OK', `${bytes} bytes, sha256 ${digest.slice(0, 16)}…${previous === undefined ? ' (recorded)' : ''}`])
}

// ---------------------------------------------------------------- installed profile

const profileDir = valueOf('profile')
if (profileDir !== null) {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    fail(`--profile: no package.json at ${profileDir}`)
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const bundles = manifest.dsh?.profile?.bundles ?? []
    const dependencies = manifest.dependencies ?? {}
    // Two different installation shapes, and only ONE of them shows up in
    // dsh.profile.bundles:
    //
    //   * a package declaring `dsh.bundle` becomes a profile LAYER, and DSH writes it into
    //     dsh.profile.bundles only when pnpm exited 0 - which is why that list, and not the
    //     exit code, is the evidence that an install actually registered.
    //   * these four packages declare only `dsh.client` (they are the app's own UI modules,
    //     re-forked), so they are plain DEPENDENCIES that replace the app's copies through
    //     the cordis.patch.yml disable+insert rows. They are correctly ABSENT from bundles,
    //     and asserting them there is a false failure.
    const expected = [...Object.values(SLUGS).map(spec => spec.packageName), '@veewo/dsh-better-tasks']
    for (const name of expected) {
      const installed = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
      if (!existsSync(installed)) { fail(`profile ${profileDir}: ${name} does not resolve in node_modules`); continue }
      const installedManifest = JSON.parse(await readFile(installed, 'utf8'))
      const isBundle = installedManifest.dsh?.bundle !== undefined
      if (isBundle) {
        if (!bundles.includes(name)) fail(`profile ${profileDir}: dsh.profile.bundles is missing ${name} (an install that exited 0 can still have skipped it)`)
      } else if (!Object.hasOwn(dependencies, name)) {
        fail(`profile ${profileDir}: ${name} is not a profile dependency (it declares no dsh.bundle, so it replaces an app module by shadowing it and MUST be a direct dependency)`)
      }
      const installedVersion = installedManifest.version
      if (name.startsWith('@deepseek-ai/dsh-client-ui-') && installedVersion !== version) {
        fail(`profile ${profileDir}: ${name}@${installedVersion} is not on the ${version} baseline`)
      }
    }
    notes.push(`profile ${profileDir}: checked ${expected.length} expected packages (${bundles.length} bundles)`)
  }
}

// ---------------------------------------------------------------- report

console.log(`baseline: dsh ${version} (tag ${sourceLock.tag}, commit ${sourceLock.commit.slice(0, 8)})`)
console.log('')
for (const [slug, state, detail] of rows) console.log(`${state.padEnd(11)} ${slug.padEnd(20)} ${detail}`)
console.log('')
if (notes.length > 0) for (const note of notes) console.log(`note: ${note}`)
if (failures.length > 0) {
  console.log('')
  for (const message of failures) console.log(`FAIL: ${message}`)
  console.log('')
  console.log(`verify-forks-0.2.0: ${failures.length} failure(s)`)
  process.exit(1)
}

const notPorted = rows.filter(([, state]) => state === 'NOT-PORTED').map(([slug]) => slug)
if (notPorted.length > 0) {
  const message = `not ported yet: ${notPorted.join(', ')}`
  if (flag('require-all')) {
    console.log(`FAIL: ${message} (--require-all)`)
    process.exit(1)
  }
  console.log(`note: ${message} — desktop install replaces all three atomically, so this is not installable yet`)
}

if (flag('write')) {
  await writeFile(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, 'utf8')
  console.log(`wrote ${lockPath.replace(`${root}\\`, '').replaceAll('\\', '/')}`)
}
console.log('verify-forks-0.2.0: OK')
