import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..'), directory = resolve(root, process.argv[2] ?? 'releases/0.3.1')
const stage = resolve(root, process.argv[3] ?? '.public-release-bundled-031')
const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'))
const forks = JSON.parse(await readFile(join(directory, 'forks-manifest.json'), 'utf8')).assets
const pack = JSON.parse(await readFile(join(directory, 'npm-pack.json'), 'utf8'))[0]
assert.equal(manifest.version, '0.3.1')
assert.equal(pack.filename, 'veewo-dsh-better-tasks-0.3.1.tgz')
for (const asset of forks) {
  assert.equal(manifest.dependencies[asset.name], asset.version)
  assert.ok(manifest.bundledDependencies.includes(asset.name))
  assert.ok(pack.files.some(file => file.path === `node_modules/${asset.name}/lib/client.js`), 'missing bundled ' + asset.name)
}
for (const value of Object.values(manifest.dependencies)) assert.doesNotMatch(value, /^(?:file:|https?:|[A-Za-z]:|\/)/)
const base = /^(?:package\.json|LICENSE|README\.md|cordis\.patch\.yml|lib\/client\.js|docs\/(?:release|rollback)\.md|src\/[^/]+\.(?:js|mjs))$/
for (const file of pack.files) {
  const bundled = forks.some(asset => file.path.startsWith(`node_modules/${asset.name}/`))
  assert.ok(bundled || base.test(file.path), 'unexpected npm file: ' + file.path)
  assert.doesNotMatch(file.path, /(?:^|\/)(?:\.npmrc|\.env|profiles|preinstall-backup|\.claw)(?:\/|$)/)
}
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const accepted = JSON.parse(await readFile(join(root, 'releases/0.2.18-desktop-sidebar-reopen/candidates.json'), 'utf8')).find(row => row.slug === 'better-tasks')
assert.equal(digest(await readFile(join(stage, 'lib/client.js'))), accepted.clientSha256)
for (const file of pack.files.filter(file => file.path.startsWith('src/') && file.path !== 'src/fork-layer.mjs')) {
  assert.equal(digest(await readFile(join(stage, file.path))), digest(await readFile(join(root, 'releases/0.2.18-desktop-sidebar-reopen/better-tasks/package', file.path))), 'feature code changed: ' + file.path)
}
for (const asset of forks) assert.equal(digest(await readFile(join(stage, 'node_modules', asset.name, 'lib/client.js'))), asset.clientSha256)
const bytes = await readFile(join(directory, pack.filename))
assert.equal('sha512-' + digest(bytes, 'sha512', 'base64'), pack.integrity)
const result = { result: 'PASS', name: manifest.name, version: manifest.version, filename: pack.filename,
  archiveSha256: digest(bytes), integrity: pack.integrity, clientSha256: accepted.clientSha256,
  bundledForks: forks.map(asset => ({ name: asset.name, clientSha256: asset.clientSha256 })),
  safeFiles: pack.files.map(file => file.path), acceptedFeatureCodeUnchanged: true, packagingScopeAdded: 'src/fork-layer.mjs' }
await writeFile(join(directory, 'package-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
