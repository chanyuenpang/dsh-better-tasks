import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
assert.equal(pkg.version, '0.3.1')
const out = resolve(root, process.argv[2] ?? 'releases/0.3.1'), stage = resolve(root, process.argv[3] ?? '.public-release-bundled-031')
const forks = JSON.parse(await readFile(join(root, 'releases/0.3.0/forks-manifest.json'), 'utf8'))
await mkdir(out)
await mkdir(stage)
await writeFile(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
for (const path of ['src', 'lib/client.js', 'cordis.patch.yml', 'LICENSE', 'README.md', 'docs/release.md', 'docs/rollback.md']) await cp(join(root, path), join(stage, path), { recursive: true })
for (const asset of forks.assets) {
  const from = join(root, 'node_modules', asset.name)
  const sha = createHash('sha256').update(await readFile(join(from, 'lib/client.js'))).digest('hex')
  assert.equal(sha, asset.clientSha256, asset.name + ': fork payload changed')
  assert.equal(pkg.dependencies[asset.name], asset.version)
  assert.ok(pkg.bundledDependencies.includes(asset.name))
  await cp(from, join(stage, 'node_modules', asset.name), { recursive: true })
  await copyFile(join(root, 'releases/0.3.0', asset.filename), join(out, asset.filename))
}
await writeFile(join(out, 'forks-manifest.json'), JSON.stringify(forks, null, 2) + '\n')
console.log(stage)
