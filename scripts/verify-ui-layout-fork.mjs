import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPatch } from 'diff'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const paths = {
  lock: resolve(root, 'provenance/ui-layout.lock.json'),
  tarball: resolve(root, 'third_party/ui-layout/0.1.5-rc.2/deepseek-ai-dsh-client-ui-layout-0.1.5-rc.2.tgz'),
  upstreamRoot: resolve(root, 'third_party/ui-layout/0.1.5-rc.2/package'),
  upstream: resolve(root, 'third_party/ui-layout/0.1.5-rc.2/package/lib/client.js'),
  installed: resolve(root, 'third_party/ui-layout/0.1.5-rc.2/installed-client.js'),
  featurePatch: resolve(root, 'patches/ui-layout/0.1.5-rc.2-better-tasks.patch'),
  typesPatch: resolve(root, 'patches/ui-layout/0.1.5-rc.2-types.patch'),
  forkRoot: resolve(root, 'forks/ui-layout'),
  fork: resolve(root, 'forks/ui-layout/lib/client.js'),
  columnsTypes: resolve(root, 'forks/ui-layout/lib/types/client/columns.d.ts'),
  storesTypes: resolve(root, 'forks/ui-layout/lib/types/client/stores.d.ts'),
  packageJson: resolve(root, 'forks/ui-layout/package.json'),
  upstreamPackageJson: resolve(root, 'third_party/ui-layout/0.1.5-rc.2/package/package.json'),
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
async function filesBelow(path) {
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => resolve(entry.parentPath ?? entry.path, entry.name))
}

const lock = JSON.parse(await text(paths.lock))
const tarball = await readFile(paths.tarball)
requireEqual(sha256(tarball), lock.sha256.tarball, 'tarball sha256')
requireEqual(`sha512-${createHash('sha512').update(tarball).digest('base64')}`, lock.registryIntegrity, 'tarball registry integrity')

const upstream = await text(paths.upstream)
const installed = await text(paths.installed)
const featurePatch = cleanPatch(await text(paths.featurePatch))
const typesPatch = cleanPatch(await text(paths.typesPatch))
requireEqual(upstream, installed, 'installed package equals published artifact')
requireEqual(sha256(Buffer.from(upstream)), lock.sha256.publishedClient, 'published client sha256')
requireEqual(sha256(Buffer.from(installed)), lock.sha256.installedBehaviorBaseline, 'installed behavior sha256')
requireEqual(sha256(Buffer.from(featurePatch)), lock.sha256.betterTasksPatch, 'feature patch sha256')
requireEqual(sha256(Buffer.from(typesPatch)), lock.sha256.typesPatch, 'types patch sha256')

const expectedFork = applyPatch(upstream, featurePatch)
if (expectedFork === false) throw new Error('better-tasks ui-layout patch no longer applies cleanly')
if (process.argv.includes('--write')) await writeFile(paths.fork, expectedFork, 'utf8')
const fork = await text(paths.fork)
requireEqual(fork, expectedFork, 'materialized fork client')
requireEqual(sha256(Buffer.from(fork)), lock.sha256.forkClient, 'fork client sha256')
requireEqual(sha256(await readFile(paths.columnsTypes)), lock.sha256.forkColumnsTypes, 'fork columns types sha256')
requireEqual(sha256(await readFile(paths.storesTypes)), lock.sha256.forkStoresTypes, 'fork stores types sha256')

const manifest = JSON.parse(await text(paths.packageJson))
const upstreamManifest = JSON.parse(await text(paths.upstreamPackageJson))
requireEqual(manifest.name, '@deepseek-ai/dsh-client-ui-layout', 'canonical package name')
requireEqual(manifest.version, lock.version, 'fork baseline version')
requireEqual(manifest.exports?.['./client']?.default, './lib/client.js', 'client export')
requireEqual(JSON.stringify(manifest.dsh?.client?.inject), JSON.stringify(upstreamManifest.dsh?.client?.inject), 'canonical inject list')

const changed = new Set(['lib/client.js', 'lib/types/client/columns.d.ts', 'lib/types/client/stores.d.ts'])
for (const upstreamFile of await filesBelow(paths.upstreamRoot)) {
  const name = relative(paths.upstreamRoot, upstreamFile).replaceAll('\\', '/')
  if (changed.has(name)) continue
  const forkFile = resolve(paths.forkRoot, name)
  requireEqual(sha256(await readFile(forkFile)), sha256(await readFile(upstreamFile)), `unchanged package file ${name}`)
}

requireCount(fork, 'id: "@deepseek-ai/dsh-client-ui-layout"', 1, 'canonical browser module id')
requireCount(fork, 'ctx.reflect.provide("layout", layout)', 1, 'layout service owner')
requireCount(fork, 'name: "root"', 1, 'root slot registrant')
requireCount(fork, 'ctx.slots.provideRoot(', 1, 'panelInfo root hook')
requireCount(fork, 'new ThemePresenter()', 1, 'theme presenter')
for (const marker of ['const SIDEBAR_MAX = 840', 'dsh-better-tasks.layout.sidebar-width.v1', 'sidebarExpandedPreference', 'writeSidebarWidthPreference(width)']) {
  if (!fork.includes(marker)) throw new Error(`feature marker missing: ${marker}`)
}
for (const child of ['"sidebar": {', '"main": {', '"rightbar": {', '"shell.overlay": {']) requireCount(fork, child, 1, `root child ${child}`)

console.log(`ui-layout fork verified: ${lock.version} ${lock.sha256.forkClient}`)
