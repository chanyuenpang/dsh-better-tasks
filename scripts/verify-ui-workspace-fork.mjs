import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPatch, createTwoFilesPatch } from 'diff'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const paths = {
  lock: resolve(root, 'provenance/ui-workspace.lock.json'),
  tarball: resolve(root, 'third_party/ui-workspace/0.1.5-rc.2/deepseek-ai-dsh-client-ui-workspace-0.1.5-rc.2.tgz'),
  upstream: resolve(root, 'third_party/ui-workspace/0.1.5-rc.2/package/lib/client.js'),
  upstreamRoot: resolve(root, 'third_party/ui-workspace/0.1.5-rc.2/package'),
  installed: resolve(root, 'third_party/ui-workspace/0.1.5-rc.2/installed-client.js'),
  installedPatch: resolve(root, 'patches/ui-workspace/0.1.5-rc.2-current-install.patch'),
  featurePatch: resolve(root, 'patches/ui-workspace/0.1.5-rc.2-better-tasks.patch'),
  typesPatch: resolve(root, 'patches/ui-workspace/0.1.5-rc.2-types.patch'),
  fork: resolve(root, 'forks/ui-workspace/lib/client.js'),
  forkRoot: resolve(root, 'forks/ui-workspace'),
  packageJson: resolve(root, 'forks/ui-workspace/package.json'),
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const text = async (path) => readFile(path, 'utf8')
const cleanPatch = (value) => value.replace(/^\uFEFF/, '')
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}
const requireCount = (source, needle, count, label) => {
  const actual = source.split(needle).length - 1
  if (actual !== count) throw new Error(`${label}: expected ${count}, got ${actual}`)
}
const slash = (value) => value.replaceAll('\\', '/')

async function refreshFeatureLock() {
  const currentLock = JSON.parse(await text(paths.lock))
  const installed = await text(paths.installed)
  const fork = await text(paths.fork)
  const featurePatch = createTwoFilesPatch(
    'a/third_party/ui-workspace/0.1.5-rc.2/installed-client.js',
    'b/forks/ui-workspace/lib/client.js',
    installed,
    fork,
    '',
    '',
    { context: 3 },
  )
  const typePatches = []
  const entries = await readdir(resolve(paths.upstreamRoot, 'lib/types'), { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue
    const upstreamFile = resolve(entry.parentPath ?? entry.path, entry.name)
    const name = slash(relative(paths.upstreamRoot, upstreamFile))
    const forkFile = resolve(paths.forkRoot, name)
    const before = await text(upstreamFile)
    const after = await text(forkFile)
    if (before === after) continue
    typePatches.push(createTwoFilesPatch(
      `a/third_party/ui-workspace/0.1.5-rc.2/package/${name}`,
      `b/forks/ui-workspace/${name}`,
      before,
      after,
      '',
      '',
      { context: 3 },
    ))
  }
  const typesPatch = typePatches.join('')
  await writeFile(paths.featurePatch, featurePatch, 'utf8')
  await writeFile(paths.typesPatch, typesPatch, 'utf8')
  currentLock.sha256.betterTasksPatch = sha256(Buffer.from(featurePatch))
  currentLock.sha256.typesPatch = sha256(Buffer.from(typesPatch))
  currentLock.sha256.forkClient = sha256(Buffer.from(fork))
  await writeFile(paths.lock, `${JSON.stringify(currentLock, null, 2)}\n`, 'utf8')
}

if (process.argv.includes('--refresh')) await refreshFeatureLock()
const lock = JSON.parse(await text(paths.lock))
const tarball = await readFile(paths.tarball)
requireEqual(sha256(tarball), lock.sha256.tarball, 'tarball sha256')
requireEqual(`sha512-${createHash('sha512').update(tarball).digest('base64')}`, lock.registryIntegrity, 'tarball registry integrity')

const upstream = await text(paths.upstream)
const installed = await text(paths.installed)
const installedPatch = cleanPatch(await text(paths.installedPatch))
const featurePatch = cleanPatch(await text(paths.featurePatch))
const typesPatch = cleanPatch(await text(paths.typesPatch))
const materializedInstalled = applyPatch(upstream, installedPatch)
if (materializedInstalled === false) throw new Error('installed-delta patch no longer applies cleanly')
requireEqual(materializedInstalled, installed, 'installed behavior materialization')
requireEqual(sha256(Buffer.from(upstream)), lock.sha256.publishedClient, 'published client sha256')
requireEqual(sha256(Buffer.from(installed)), lock.sha256.installedBehaviorBaseline, 'installed behavior sha256')
requireEqual(sha256(Buffer.from(installedPatch)), lock.sha256.installedDeltaPatch, 'installed patch sha256')
requireEqual(sha256(Buffer.from(featurePatch)), lock.sha256.betterTasksPatch, 'feature patch sha256')
requireEqual(sha256(Buffer.from(typesPatch)), lock.sha256.typesPatch, 'types patch sha256')

const expectedFork = applyPatch(installed, featurePatch)
if (expectedFork === false) throw new Error('better-tasks patch no longer applies cleanly')
if (process.argv.includes('--write')) await writeFile(paths.fork, expectedFork, 'utf8')
const fork = await text(paths.fork)
requireEqual(fork, expectedFork, 'materialized fork client')
requireEqual(sha256(Buffer.from(fork)), lock.sha256.forkClient, 'fork client sha256')

const manifest = JSON.parse(await text(paths.packageJson))
requireEqual(manifest.name, '@deepseek-ai/dsh-client-ui-workspace', 'canonical package name')
requireEqual(manifest.version, lock.version, 'fork baseline version')
requireEqual(manifest.exports?.['./client']?.default, './lib/client.js', 'client export')
requireCount(fork, 'id: "@deepseek-ai/dsh-client-ui-workspace"', 1, 'canonical browser module id')
requireCount(fork, 'new UiWorkspaceService(', 1, 'uiWorkspace service owner')
requireCount(fork, 'ctx.slots.inject("sidebar.workspaces"', 1, 'workspace browser registrant')
requireCount(fork, 'ctx.slots.inject("conversation.hero.workspace"', 1, 'conversation picker registrant')
for (const marker of ['betterTaskPins', 'setActivityRange', 'sessionInActivityRange', 'TaskPinIcon', 'startSession(workspaceId, beforeOpen)', 'onSessionCreated(listener)', 'this.notifySessionCreated(sessionId)', 'this.sessionCreatedListeners.clear()']) {
  if (!fork.includes(marker)) throw new Error(`feature marker missing: ${marker}`)
}

console.log(`ui-workspace fork verified: ${lock.version} ${lock.sha256.forkClient}`)
