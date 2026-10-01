import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const directory = resolve(process.argv[2] ?? 'releases/0.3.0')
const sourceCommit = process.argv[3]
assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/)
const forks = JSON.parse(await readFile(join(directory, 'forks-manifest.json'), 'utf8'))
const main = JSON.parse(await readFile(join(directory, 'package-verification.json'), 'utf8'))
assert.equal(main.result, 'PASS')
const candidates = forks.assets.map(asset => ({ slug: asset.slug, name: asset.name, version: asset.version,
  archive: join(directory, asset.filename), archiveSha256: asset.sha256, clientSha256: asset.clientSha256 }))
candidates.push({ slug: 'better-tasks', name: main.name, version: main.version,
  archive: join(directory, main.filename), archiveSha256: main.archiveSha256, clientSha256: main.clientSha256 })
await writeFile(join(directory, 'candidates.json'), JSON.stringify(candidates, null, 2) + '\n')
// This is the ONLY manifest attached publicly; it has no private storage or local paths.
const publicManifest = { schemaVersion: 1, name: main.name, version: main.version, dshVersion: '0.2.0-rc.2',
  sourceCommit, sourceTag: 'v0.3.0', forkLibraryTag: forks.libraryTag,
  main: { filename: main.filename, sha256: main.archiveSha256, integrity: main.integrity, clientSha256: main.clientSha256,
    url: `https://github.com/chanyuenpang/dsh-better-tasks/releases/download/v0.3.0/${main.filename}` },
  forks: forks.assets }
await writeFile(join(directory, 'manifest.json'), JSON.stringify(publicManifest, null, 2) + '\n')
console.log(JSON.stringify(publicManifest, null, 2))
