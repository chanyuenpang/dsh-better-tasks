// Anonymous consumer download check; no credential headers, no Profile modification.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const directory = resolve(process.argv[2] ?? 'releases/0.3.0')
const manifest = JSON.parse(await readFile(join(directory, 'forks-manifest.json'), 'utf8'))
const results = []
for (const asset of manifest.assets) {
  const response = await fetch(asset.url, { redirect: 'follow' })
  assert.equal(response.ok, true, `${asset.filename}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256, asset.sha256, asset.filename + ': public download does not match accepted bytes')
  assert.equal(bytes.length, asset.size)
  results.push({ filename: asset.filename, url: asset.url, sha256, size: bytes.length })
}
const result = { result: 'PASS', anonymousDownloads: true, assets: results }
await writeFile(join(directory, 'public-forks-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
