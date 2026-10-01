import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const version = process.argv[2] ?? '0.2.2'
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('expected an exact numeric release version')
const root = resolve(import.meta.dirname, '..')
const release = join(root, 'releases', `${version}-unscoped`)
const stage = join(release, 'stage')
const archive = join(release, `dsh-better-tasks-${version}.tgz`)
try { await stat(archive); throw new Error(`immutable release already exists: ${archive}`) }
catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(join(stage, 'lib'), { recursive: true })
await cp(join(root, 'src'), join(stage, 'src'), { recursive: true })
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
manifest.name = 'dsh-better-tasks'
manifest.version = version
manifest.private = true
await writeFile(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const bundle = await readFile(join(root, 'lib', 'client.js'), 'utf8')
const scopedId = '  id: "@veewo/dsh-better-tasks",'
if (bundle.split(scopedId).length !== 2 || !bundle.includes('async function continueIdleTask(')) {
  throw new Error('browser bundle identity or action definitions are not as expected')
}
await writeFile(join(stage, 'lib', 'client.js'), bundle.replace(scopedId, '  id: "dsh-better-tasks",'))
console.log(`Staged ${manifest.name}@${version} at ${stage}`)
