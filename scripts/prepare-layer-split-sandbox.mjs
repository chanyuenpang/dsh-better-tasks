// Prepare an isolated sandbox for a fork candidate line.
//
// Mirrors the real desktop profile's shape (isolated linker, publicHoistPattern over
// the six fork names) but owns its DSH_HOME, profile, sessions and storage. The
// better-tasks plugin tarball is shared across lines (the plugin is line-agnostic);
// only the six fork payloads change, so the gate proves the new artifact bytes boot.
//
// usage:
//   node scripts/prepare-layer-split-sandbox.mjs [sandboxDir] [releaseDir] [port] [sourceProfile]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const base = resolve(root, process.argv[2] ?? 'sandbox/.desktop-layer-split')
const release = resolve(root, process.argv[3] ?? 'releases/0.2.2-rc.1-forks')
const port = Number(process.argv[4] ?? 39422)
const source = (process.argv[5] ?? 'C:/Users/chany/.dsh/profiles/desktop').replaceAll('\\', '/')
const pluginTarball = resolve(root, 'releases/veewo-dsh-better-tasks-0.4.0.tgz')

const candidates = JSON.parse(await readFile(join(release, 'candidates.json'), 'utf8'))
const FORKS = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

if (existsSync(join(base, 'baseline.json'))) {
  throw new Error(base + ' already holds a baseline; a cold-start gate must be a fresh profile')
}

const home = join(base, 'home')
const profile = join(home, 'profiles/desktop')
await mkdir(profile, { recursive: true })

const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const dependencies = { ...sourceManifest.dependencies }
for (const candidate of candidates) {
  if (!FORKS.includes(candidate.slug)) continue
  dependencies[candidate.name] = 'file:' + candidate.archive.replaceAll('\\', '/')
}
dependencies['@veewo/dsh-better-tasks'] = 'file:' + pluginTarball.replaceAll('\\', '/')
const manifest = {
  name: sourceManifest.name,
  private: true,
  dependencies,
  dsh: sourceManifest.dsh,
}
await writeFile(join(profile, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

// The linker policy is the whole mechanism: the six fork names must occupy the
// profile root, and no other @deepseek-ai package may, or the app's own core rows
// load the profile copy and fail to resolve cordis.
const workspace = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: isolated',
  'autoInstallPeers: false',
  '',
  'publicHoistPattern:',
  // FORKS entries are already fully qualified (`ui-layout`, not `layout`).
  ...FORKS.map((slug) => `  - '@deepseek-ai/dsh-client-${slug}'`),
  '',
].join('\n')
await writeFile(join(profile, 'pnpm-workspace.yaml'), workspace)

await copyFile(join(source, 'cordis.yml'), join(profile, 'cordis.yml'))
const patch = await readFile(join(source, 'cordis.patch.yml'), 'utf8')
// Sandbox-owned safety: no mobile/P2P effects, loopback-only listener.
const safety = `\n# Sandbox-owned: no mobile/P2P side effects.\n- id: dsh-cindy-host\n  disabled: true\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: ${port}\n`
await writeFile(join(profile, 'cordis.patch.yml'), patch + safety)

const baseline = {
  createdAt: new Date().toISOString(),
  source,
  home,
  profile,
  release,
  candidates,
  forks: FORKS,
  nodeLinker: 'isolated with publicHoistPattern over the six fork names',
  port,
}
await writeFile(join(base, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n')
console.log(JSON.stringify(baseline, null, 2))
