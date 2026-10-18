// Packaging-only experiment. No runtime, Profile, publication or accepted artifact writes.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..'), destination = join(root, '.public-release-bundled-probe-030')
const forks = JSON.parse(await readFile(join(root, 'releases/0.3.0/forks-manifest.json'), 'utf8')).assets
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
pkg.version = '0.3.0-bundle-probe.1'
pkg.bundledDependencies = forks.map(asset => asset.name)
for (const asset of forks) pkg.dependencies[asset.name] = asset.version
await mkdir(destination)
await writeFile(join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
for (const path of ['src', 'lib/client.js', 'cordis.patch.yml', 'LICENSE', 'README.md', 'docs/release.md', 'docs/rollback.md']) await cp(join(root, path), join(destination, path), { recursive: true })
const sha = data => createHash('sha256').update(data).digest('hex')
for (const asset of forks) {
  const from = join(root, 'node_modules', asset.name)
  assert.equal(sha(await readFile(join(from, 'lib/client.js'))), asset.clientSha256, asset.name)
  await cp(from, join(destination, 'node_modules', asset.name), { recursive: true })
}
console.log(destination)
