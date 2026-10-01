// Immutable repair candidates for the existing desktop fork composition.
// Empty bundle layers let the supported Plugin Manager replace plain packages
// with enabled:false; the existing user-layer rows remain the sole composition.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, process.argv[2] ?? 'releases/0.2.6-desktop-repair-r2')
const candidates = [
  { source: root, dir: 'better-tasks', files: ['src', 'lib/client.js', 'LICENSE'], version: '0.2.6' },
  { source: resolve(root, 'forks-0.2.0-rc.2/ui-workspace'), dir: 'ui-workspace', files: ['lib', 'LICENSE'] },
]
await mkdir(destination)
const records = []
for (const candidate of candidates) {
  const path = resolve(destination, candidate.dir)
  await mkdir(path)
  for (const file of candidate.files) await cp(resolve(candidate.source, file), resolve(path, file), {recursive:true})
  const manifest = JSON.parse(await readFile(resolve(candidate.source, 'package.json'), 'utf8'))
  if (candidate.version) manifest.version = candidate.version
  manifest.dsh.bundle = { patch: './cordis.patch.yml' }
  manifest.files = [...candidate.files, 'cordis.patch.yml']
  delete manifest.scripts
  delete manifest.devDependencies
  await writeFile(resolve(path, 'package.json'), JSON.stringify(manifest,null,2)+'\n')
  await writeFile(resolve(path, 'cordis.patch.yml'), '# Existing desktop profile owns the fork rows. Install with enabled:false.\n[]\n')
  const artifact = await readFile(resolve(path, 'lib/client.js'))
  records.push({name:manifest.name,version:manifest.version,path,clientSha256:createHash('sha256').update(artifact).digest('hex')})
}
await writeFile(resolve(destination, 'candidates.json'),JSON.stringify(records,null,2)+'\n')
console.log(JSON.stringify(records,null,2))
