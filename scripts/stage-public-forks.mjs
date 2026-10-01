// Stage only audited code archives: never copy a release's profile backups or logs.
import assert from 'node:assert/strict'
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..')
const source = resolve(root, process.argv[2] ?? 'releases/0.2.18-desktop-sidebar-reopen')
const output = resolve(root, process.argv[3] ?? 'releases/0.3.0')
const tag = 'better-tasks-forks-0.2.0-rc.2-r1'
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']
const hash = data => createHash('sha256').update(data).digest('hex')
const rows = JSON.parse(await readFile(join(source, 'candidates.json'), 'utf8')).filter(row => row.slug !== 'better-tasks')
assert.deepEqual(rows.map(row => row.slug).sort(), [...slugs].sort())
await mkdir(output) // An immutable attempt; never overwrite an existing release.
const assets = []
for (const row of rows) {
  assert.equal(row.name, '@deepseek-ai/dsh-client-' + row.slug)
  assert.equal(row.version, '0.2.0-rc.2')
  const filename = `deepseek-ai-dsh-client-${row.slug}-${row.version}.tgz`
  assert.equal(basename(row.archive), filename)
  const bytes = await readFile(row.archive)
  assert.equal(hash(bytes), row.archiveSha256, row.slug + ': accepted archive changed')
  assert.equal(hash(await readFile(join(root, 'forks-0.2.0-rc.2', row.slug, 'lib/client.js'))), row.clientSha256, row.slug + ': source-tree artifact drift')
  await copyFile(row.archive, join(output, filename))
  assets.push({ slug: row.slug, name: row.name, version: row.version, filename,
    url: `https://github.com/chanyuenpang/dsh-better-tasks/releases/download/${tag}/${filename}`,
    sha256: row.archiveSha256, clientSha256: row.clientSha256, size: bytes.length })
}
const manifest = { schemaVersion: 1, libraryTag: tag, dshVersion: '0.2.0-rc.2',
  purpose: 'Audited Better Tasks compatibility forks; not official npm releases and not a standalone plugin.', assets }
await writeFile(join(output, 'forks-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
