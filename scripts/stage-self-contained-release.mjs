import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

// Stage the self-contained public package: the main tarball payload plus the six native-named
// Client fork payloads as npm `bundledDependencies`, copied out of the installed node_modules.
//
// The fork payloads are NOT the registry builds: they are the audited fork archives recorded in
// a fork-library manifest (releases/<dsh-version>-forks/forks-manifest.json). This script hashes
// what node_modules actually holds against that manifest, so a developer install that replaced a
// fork with the stock package fails here instead of shipping silently.
//
// usage:
//   node scripts/stage-self-contained-release.mjs \
//     [--forks releases/<ver>-forks/forks-manifest.json] [--out releases/<ver>] [--stage .public-release-bundled-<tag>]

const root = resolve(import.meta.dirname, '..')
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const forksPath = arg('forks', 'releases/0.2.0-rc.2-forks/forks-manifest.json')
const out = resolve(root, arg('out', `releases/${pkg.version}`))
const stage = resolve(root, arg('stage', '.public-release-bundled-release'))
const forks = JSON.parse(await readFile(join(root, forksPath), 'utf8'))
const forksDir = resolve(root, forksPath, '..')

await mkdir(out)
await mkdir(stage)
await writeFile(join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
for (const path of ['src', 'lib/client.js', 'cordis.patch.yml', 'LICENSE', 'README.md', 'docs/release.md', 'docs/rollback.md']) {
  await cp(join(root, path), join(stage, path), { recursive: true })
}
for (const asset of forks.assets) {
  const from = join(root, 'node_modules', asset.name)
  const sha = createHash('sha256').update(await readFile(join(from, 'lib/client.js'))).digest('hex')
  assert.equal(sha, asset.clientSha256, `${asset.name}: fork payload changed`)
  assert.equal(pkg.dependencies[asset.name], asset.version, `${asset.name}: dependency version differs from the fork library`)
  assert.ok(pkg.bundledDependencies.includes(asset.name), `${asset.name}: not declared as a bundled dependency`)
  await cp(from, join(stage, 'node_modules', asset.name), { recursive: true })
  await copyFile(join(forksDir, asset.filename), join(out, asset.filename))
}
await writeFile(join(out, 'forks-manifest.json'), `${JSON.stringify(forks, null, 2)}\n`)
console.log(stage)
