// Validate public npm content/dependencies and match the user-accepted Desktop code.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, process.argv[2] ?? 'releases/0.3.0')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const forks = JSON.parse(await readFile(join(directory, 'forks-manifest.json'), 'utf8')).assets
const pack = JSON.parse(await readFile(join(directory, 'npm-pack.json'), 'utf8'))[0]
assert.equal(manifest.name, '@veewo/dsh-better-tasks')
assert.equal(manifest.version, '0.3.0')
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(pack.filename, 'veewo-dsh-better-tasks-0.3.0.tgz')
for (const fork of forks) assert.equal(manifest.dependencies[fork.name], fork.url)
for (const value of Object.values(manifest.dependencies)) {
  assert.doesNotMatch(value, /^(?:file:|[A-Za-z]:|\/)/, 'machine-local public dependency')
}
for (const peer of ['@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-storage-domain']) assert.equal(manifest.peerDependencies[peer], '0.2.0-rc.2')
const allowed = /^(?:package\.json|LICENSE|README\.md|cordis\.patch\.yml|lib\/client\.js|docs\/(?:release|rollback)\.md|src\/[^/]+\.(?:js|mjs))$/
for (const file of pack.files) assert.match(file.path, allowed, 'unexpected npm payload: ' + file.path)
for (const required of ['package.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'lib/client.js', 'src/index.js', 'src/native-pin-host.mjs']) assert.ok(pack.files.some(file => file.path === required), required)
const accepted = JSON.parse(await readFile(join(root, 'releases/0.2.18-desktop-sidebar-reopen/candidates.json'), 'utf8')).find(row => row.slug === 'better-tasks')
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
assert.equal(digest(await readFile(join(root, 'lib/client.js'))), accepted.clientSha256, 'public release silently changes accepted client code')
for (const file of pack.files.filter(file => file.path.startsWith('src/'))) {
  assert.equal(digest(await readFile(join(root, file.path))), digest(await readFile(join(root, 'releases/0.2.18-desktop-sidebar-reopen/better-tasks/package', file.path))), 'accepted source drift: ' + file.path)
}
const bytes = await readFile(join(directory, pack.filename))
assert.equal('sha512-' + digest(bytes, 'sha512', 'base64'), pack.integrity)
const result = { result: 'PASS', name: manifest.name, version: manifest.version, filename: pack.filename,
  archiveSha256: digest(bytes), integrity: pack.integrity, clientSha256: accepted.clientSha256,
  publicDependencies: forks.map(row => ({ name: row.name, url: row.url, sha256: row.sha256 })),
  safeFiles: pack.files.map(row => row.path), acceptedCodeUnchanged: true }
await writeFile(join(directory, 'package-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
