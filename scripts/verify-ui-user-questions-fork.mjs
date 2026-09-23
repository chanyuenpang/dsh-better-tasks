import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPatch, createTwoFilesPatch, parsePatch } from 'diff'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const base = resolve(root, 'third_party/ui-user-questions/0.1.5-rc.2')
const paths = {
  lock: resolve(root, 'provenance/ui-user-questions.lock.json'),
  tarball: resolve(base, 'deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz'),
  registry: resolve(base, 'registry-dist.json'),
  npmPack: resolve(base, 'npm-pack.json'),
  sourceTag: resolve(base, 'source-tag.json'),
  upstreamRoot: resolve(base, 'package'),
  upstreamClient: resolve(base, 'package/lib/client.js'),
  installedClient: resolve(base, 'installed-client.js'),
  featurePatch: resolve(root, 'patches/ui-user-questions/0.1.5-rc.2-feature.patch'),
  typesPatch: resolve(root, 'patches/ui-user-questions/0.1.5-rc.2-types.patch'),
  forkRoot: resolve(root, 'forks/ui-user-questions'),
  forkClient: resolve(root, 'forks/ui-user-questions/lib/client.js'),
  packageJson: resolve(root, 'forks/ui-user-questions/package.json'),
  upstreamPackageJson: resolve(base, 'package/package.json'),
}

const sha = (algorithm, value) => createHash(algorithm).update(value).digest(algorithm === 'sha512' ? 'base64' : 'hex')
const sha256 = (value) => sha('sha256', value)
const text = async (path) => readFile(path, 'utf8')
const cleanPatch = (value) => value.replace(/^\uFEFF/, '')
const slash = (value) => value.replaceAll('\\', '/')
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}
const requireCount = (source, needle, count, label) => {
  const actual = source.split(needle).length - 1
  if (actual !== count) throw new Error(`${label}: expected ${count}, got ${actual}`)
}

async function filesBelow(path) {
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath ?? entry.path, entry.name))
}

async function fileMap(path) {
  const entries = []
  for (const file of await filesBelow(path)) {
    entries.push([slash(relative(path, file)), file])
  }
  entries.sort(([left], [right]) => compare(left, right))
  return new Map(entries)
}

async function packageTreeHash(path) {
  const hash = createHash('sha256')
  for (const [name, file] of await fileMap(path)) {
    const body = await readFile(file)
    hash.update(`${Buffer.byteLength(name)}:${name}${body.length}:`)
    hash.update(body)
  }
  return hash.digest('hex')
}

function patchPath(header) {
  const value = header?.replace(/^[ab]\//, '')
  if (value === undefined || value === '' || value === '/dev/null' || value.startsWith('../') || value.includes('/../')) {
    throw new Error(`invalid patch path: ${String(header)}`)
  }
  return slash(value)
}

function parsedPatches(source, label) {
  if (source.trim() === '') return []
  const patches = parsePatch(source)
  if (patches.length === 0) throw new Error(`${label}: non-empty patch parsed no file deltas`)
  return patches
}

async function refreshFeatureLock() {
  const currentLock = JSON.parse(await text(paths.lock))
  const upstreamFiles = await fileMap(paths.upstreamRoot)
  const forkFiles = await fileMap(paths.forkRoot)
  requireEqual(JSON.stringify([...forkFiles.keys()]), JSON.stringify([...upstreamFiles.keys()]), 'refresh package file set')
  const feature = []
  const types = []
  const patchedFiles = []
  for (const [name, upstreamFile] of upstreamFiles) {
    const before = await text(upstreamFile)
    const after = await text(forkFiles.get(name))
    if (before === after) continue
    patchedFiles.push(name)
    const patch = createTwoFilesPatch(`a/${name}`, `b/${name}`, before, after, '', '', { context: 3 })
    ;(name.startsWith('lib/types/') && name.endsWith('.d.ts') ? types : feature).push(patch)
  }
  const featurePatch = feature.join('')
  const typesPatch = types.join('')
  await writeFile(paths.featurePatch, featurePatch, 'utf8')
  await writeFile(paths.typesPatch, typesPatch, 'utf8')
  currentLock.patchedFiles = patchedFiles.sort(compare)
  currentLock.sha256.featurePatch = sha256(Buffer.from(featurePatch))
  currentLock.sha256.typesPatch = sha256(Buffer.from(typesPatch))
  currentLock.sha256.forkClient = sha256(await readFile(paths.forkClient))
  currentLock.sha256.forkPackageTree = await packageTreeHash(paths.forkRoot)
  await writeFile(paths.lock, `${JSON.stringify(currentLock, null, 2)}\n`, 'utf8')
}

if (process.argv.includes('--refresh')) await refreshFeatureLock()
const lock = JSON.parse(await text(paths.lock))
const registry = JSON.parse(await text(paths.registry))
const npmPack = JSON.parse(await text(paths.npmPack))[0]
const sourceTag = JSON.parse(await text(paths.sourceTag))
const tarball = await readFile(paths.tarball)

requireEqual(sha256(tarball), lock.sha256.tarball, 'tarball sha256')
requireEqual(`sha512-${sha('sha512', tarball)}`, lock.registryIntegrity, 'tarball registry integrity')
requireEqual(sha('sha1', tarball), lock.registryShasum, 'tarball registry shasum')
requireEqual(registry.integrity, lock.registryIntegrity, 'registry metadata integrity')
requireEqual(registry.shasum, lock.registryShasum, 'registry metadata shasum')
requireEqual(registry.fileCount, 14, 'registry file count')
requireEqual(npmPack.integrity, lock.registryIntegrity, 'npm pack integrity')
requireEqual(npmPack.shasum, lock.registryShasum, 'npm pack shasum')
requireEqual(npmPack.entryCount, 14, 'npm pack entry count')
requireEqual(sourceTag.tag, lock.sourceTag, 'source tag')
requireEqual(sourceTag.commit, lock.sourceCommit, 'source commit')
requireEqual(await packageTreeHash(paths.upstreamRoot), lock.sha256.publishedPackageTree, 'published package tree sha256')

const upstreamClient = await text(paths.upstreamClient)
const installedClient = await text(paths.installedClient)
requireEqual(upstreamClient, installedClient, 'installed package equals published artifact')
requireEqual(sha256(Buffer.from(upstreamClient)), lock.sha256.publishedClient, 'published client sha256')
requireEqual(sha256(Buffer.from(installedClient)), lock.sha256.installedBehaviorBaseline, 'installed behavior sha256')

const featurePatch = cleanPatch(await text(paths.featurePatch))
const typesPatch = cleanPatch(await text(paths.typesPatch))
requireEqual(sha256(Buffer.from(featurePatch)), lock.sha256.featurePatch, 'feature patch sha256')
requireEqual(sha256(Buffer.from(typesPatch)), lock.sha256.typesPatch, 'types patch sha256')

const upstreamFiles = await fileMap(paths.upstreamRoot)
const forkFiles = await fileMap(paths.forkRoot)
const expected = new Map()
for (const [name, file] of upstreamFiles) expected.set(name, await readFile(file))

const featurePatches = parsedPatches(featurePatch, 'feature patch')
const typePatches = parsedPatches(typesPatch, 'types patch')
const patchedFiles = []
for (const [label, patches] of [['feature patch', featurePatches], ['types patch', typePatches]]) {
  for (const patch of patches) {
    const oldName = patchPath(patch.oldFileName)
    const newName = patchPath(patch.newFileName)
    requireEqual(newName, oldName, `${label} renamed file`)
    if (label === 'types patch' && (!newName.startsWith('lib/types/') || !newName.endsWith('.d.ts'))) {
      throw new Error(`types patch targets non-type file: ${newName}`)
    }
    if (label === 'feature patch' && newName.startsWith('lib/types/')) {
      throw new Error(`feature patch targets type file: ${newName}`)
    }
    const current = expected.get(newName)
    if (current === undefined) throw new Error(`${label} targets unpublished file: ${newName}`)
    const materialized = applyPatch(current.toString('utf8'), patch)
    if (materialized === false) throw new Error(`${label} no longer applies cleanly: ${newName}`)
    expected.set(newName, Buffer.from(materialized))
    patchedFiles.push(newName)
    if (process.argv.includes('--write')) await writeFile(resolve(paths.forkRoot, newName), materialized, 'utf8')
  }
}

const normalizedPatchedFiles = [...new Set(patchedFiles)].sort(compare)
requireEqual(JSON.stringify(normalizedPatchedFiles), JSON.stringify(lock.patchedFiles), 'patched file list')
requireEqual(JSON.stringify([...forkFiles.keys()]), JSON.stringify([...upstreamFiles.keys()]), 'fork package file set')
for (const [name, body] of expected) {
  const forkFile = forkFiles.get(name)
  if (forkFile === undefined) throw new Error(`fork package file missing: ${name}`)
  requireEqual(sha256(await readFile(forkFile)), sha256(body), `${normalizedPatchedFiles.includes(name) ? 'patched' : 'unchanged'} package file ${name}`)
}
requireEqual(await packageTreeHash(paths.forkRoot), lock.sha256.forkPackageTree, 'fork package tree sha256')

const fork = await text(paths.forkClient)
requireEqual(sha256(Buffer.from(fork)), lock.sha256.forkClient, 'fork client sha256')
const manifest = JSON.parse(await text(paths.packageJson))
const upstreamManifest = JSON.parse(await text(paths.upstreamPackageJson))
requireEqual(manifest.name, '@deepseek-ai/dsh-client-ui-user-questions', 'canonical package name')
requireEqual(manifest.version, lock.version, 'fork baseline version')
requireEqual(manifest.exports?.['./client']?.default, './lib/client.js', 'client export')
requireEqual(JSON.stringify(manifest.dsh?.client?.inject), JSON.stringify(upstreamManifest.dsh?.client?.inject), 'canonical inject list')

requireCount(fork, 'id: "@deepseek-ai/dsh-client-ui-user-questions"', 1, 'canonical browser module id')
requireCount(fork, 'ctx.slots.register({', 1, 'slot registrant count')
requireCount(fork, 'ctx.slots.inject("conversation.composer"', 1, 'conversation composer registrant')
requireCount(fork, 'name: "conversation.composer"', 1, 'conversation composer registration name')
requireCount(fork, 'ctx.remote.$on("user-questions/request"', 1, 'Remote question listener')
requireCount(fork, 'return answerQuestion(ctx, this, request, next, registerPendingInteraction, registry);', 1, 'Remote waterfall delegation')
requireCount(fork, 'ctx.effect(() => ctx.locale.register(NS, {', 1, 'locale lifecycle registration')
requireCount(fork, 'ctx.uiSession.registerPendingInteraction(', 1, 'pending interaction registration')
requireCount(fork, 'signal.addEventListener("abort", onAbort, { once: true })', 1, 'request abort listener')
requireCount(fork, 'this.#signal.removeEventListener("abort", this.#onAbort)', 1, 'request abort listener teardown')
requireCount(fork, '\n\t\t\t\tremove();\n', 1, 'pending interaction teardown')
requireCount(fork, 'completed.resolve();', 1, 'pending interaction completion')
requireCount(fork, 'locale: NS', 1, 'composer locale seat')
requireCount(fork, 'ctx.reflect.provide("questionSurface", questionSurface)', 1, 'shared question surface provider')
requireCount(fork, '"data-question-surface": variant', 1, 'surface-neutral official router')
requireCount(fork, 'createQuestionDraftStore().create()', 1, 'request-scoped shared draft store')
requireCount(fork, 'if (!this.lock(record))', 1, 'single-settlement surface gate')
requireCount(fork, 'registry.forget(pending);', 1, 'settled request state teardown')
requireCount(fork, 'style.remove();', 1, 'task-card style teardown')

console.log(`ui-user-questions fork verified: ${lock.version} ${lock.sha256.forkClient}`)
