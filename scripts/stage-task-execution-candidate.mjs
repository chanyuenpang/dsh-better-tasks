// Local main-only rollout: preserve the installed composition and fork dependencies.
import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..')
const real = 'C:/Users/chany/.dsh/profiles/desktop'
const installed = join(real, 'node_modules/@veewo/dsh-better-tasks')
const version = process.argv[2] ?? '0.2.20-dsh021.3'
assert.match(version, /^0\.2\.\d+-dsh021\.3$/)
const release = join(root, `releases/task-execution-${version}`)
const base = join(root, `sandbox/.task-execution-${version}`)
const stage = join(release, 'package')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await mkdir(release)
await mkdir(stage)
for (const path of ['src', 'lib/client.js', 'LICENSE']) await cp(join(root, path), join(stage, path), { recursive: true })
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
manifest.version = version
await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
await copyFile(join(installed, 'cordis.patch.yml'), join(stage, 'cordis.patch.yml'))
const archive = join(release, `veewo-dsh-better-tasks-${version}.tgz`)
const packed = spawnSync('tar', ['-czf', archive, '-C', release, 'package'], { stdio: 'inherit' })
assert.equal(packed.status, 0)
const candidates = [{ slug: 'better-tasks', name: manifest.name, version, archive, archiveSha256: hash(await readFile(archive)), clientSha256: hash(await readFile(join(stage, 'lib/client.js'))) }]
for (const [name, spec] of Object.entries(manifest.dependencies)) {
  if (!name.startsWith('@deepseek-ai/dsh-client-ui-')) continue
  candidates.push({ slug: name.split('/dsh-client-')[1], name, archive: spec.slice(5), archiveSha256: hash(await readFile(spec.slice(5))), clientSha256: hash(await readFile(join(real, 'node_modules', name, 'lib/client.js'))) })
}
await writeFile(join(release, 'candidates.json'), JSON.stringify(candidates, null, 2) + '\n')
await mkdir(base)
const home = join(base, 'home'), profile = join(home, 'profiles/desktop')
await mkdir(profile, { recursive: true })
const realManifest = await readFile(join(real, 'package.json'), 'utf8')
const profileManifest = JSON.parse(realManifest)
profileManifest.dependencies[manifest.name] = 'file:' + archive.replaceAll('\\', '/')
await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest, null, 2) + '\n')
for (const file of ['cordis.yml', 'pnpm-workspace.yaml']) await copyFile(join(real, file), join(profile, file))
const lock = await readFile(join(real, 'pnpm-lock.yaml'), 'utf8')
await writeFile(join(profile, 'pnpm-lock.yaml'), lock.replace(/file:([^\s,'"{}()]+\.tgz)/g, (_, path) => 'file:' + resolve(real, path).replaceAll('\\', '/')))
const patch = await readFile(join(real, 'cordis.patch.yml'), 'utf8')
await writeFile(join(profile, 'cordis.patch.yml'), patch + '\n# Isolated startup only: no mobile/P2P; independent storage/ledger.\n- id: dsh-cindy-host\n  disabled: true\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 39422\n')
const baseline = { home, profile, realProfile: real, source: real, release, candidates, profileManifestSha256: hash(realManifest), profilePatchSha256: hash(patch), port: 39422, cdp: 9228 }
await writeFile(join(base, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n')
console.log(JSON.stringify({ release, base, archive, profile, candidates }, null, 2))
