// Fetch and pin an upstream @deepseek-ai client-UI tarball as a fork baseline.
//
// Reproduces the layout of third_party/<slug>/<version>/:
//   <name>-<version>.tgz   the pristine registry tarball
//   package/               the extracted tarball (npm's `package/` root)
//   registry-dist.json     the registry `dist` object, verbatim, plus name/version
//   npm-pack.json          `npm pack --dry-run --json` over the extracted tree
//   source-tag.json        the upstream git tag/commit the release came from
//
// Integrity is verified against the registry's own sha512 + shasum before anything
// is written, so a baseline can never be pinned from a corrupted download.
//
// usage: node scripts/fetch-upstream-fork.mjs <slug> <packageName> <version>

import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [slug, packageName, version] = process.argv.slice(2)
if (!slug || !packageName || !version) {
  console.error('usage: node scripts/fetch-upstream-fork.mjs <slug> <packageName> <version>')
  process.exit(2)
}

const registry = 'https://registry.npmjs.org/'
const metaUrl = `${registry}${packageName.replace('/', '%2f')}`
const target = resolve(root, 'third_party', slug, version)

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return response.json()
}

console.log(`fetching registry metadata: ${metaUrl}`)
const meta = await fetchJson(metaUrl)
const entry = meta.versions?.[version]
if (!entry) throw new Error(`${packageName}@${version} is not published; latest is ${meta['dist-tags']?.latest}`)
const dist = entry.dist

console.log(`downloading ${dist.tarball}`)
const response = await fetch(dist.tarball)
if (!response.ok) throw new Error(`${dist.tarball} -> HTTP ${response.status}`)
const tarball = Buffer.from(await response.arrayBuffer())

const actualIntegrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
if (actualIntegrity !== dist.integrity) throw new Error(`integrity mismatch: registry ${dist.integrity}, downloaded ${actualIntegrity}`)
const actualShasum = createHash('sha1').update(tarball).digest('hex')
if (actualShasum !== dist.shasum) throw new Error(`shasum mismatch: registry ${dist.shasum}, downloaded ${actualShasum}`)
console.log(`integrity ok: ${actualIntegrity}`)
console.log(`tarball sha256: ${sha256(tarball)}`)

const filename = dist.tarball.split('/').pop()
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await writeFile(resolve(target, filename), tarball)

const packageDir = resolve(target, 'package')
await mkdir(packageDir, { recursive: true })
await run('tar', ['-xzf', resolve(target, filename), '--strip-components=1', '-C', packageDir])

await writeFile(resolve(target, 'registry-dist.json'), `${JSON.stringify({ name: packageName, version, ...dist }, null, 2)}\n`)

const { stdout: packJson } = await run('npm', ['pack', '--dry-run', '--json'], { cwd: packageDir, shell: true })
await writeFile(resolve(target, 'npm-pack.json'), `${JSON.stringify(JSON.parse(packJson), null, 2)}\n`)

const tag = `dsh-v${version}`
let sourceTag = {
  repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  tag,
  commit: null,
  note: 'Review provenance only; the published package is the executable baseline because standalone source rebuild is not byte-reproducible from the npm artifact.',
}
try {
  const ref = await fetchJson(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/${tag}`)
  sourceTag.commit = ref.object.type === 'tag'
    ? (await fetchJson(ref.object.url)).object.sha
    : ref.object.sha
  console.log(`resolved ${tag} -> ${sourceTag.commit}`)
} catch (error) {
  console.warn(`could not resolve ${tag} from GitHub (${error.message}); commit left null`)
}
await writeFile(resolve(target, 'source-tag.json'), `${JSON.stringify(sourceTag, null, 2)}\n`)

console.log(`pinned ${packageName}@${version} at third_party/${slug}/${version}`)
