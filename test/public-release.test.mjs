import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']
const readDoc = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('Desktop install and rollback point to the managed-profile runbook, not a runnable CLI recipe', () => {
  assert.ok(manifest.files.includes('docs/install-desktop.md'))
  for (const path of ['README.md', 'AGENTS.md', 'docs/install.md', 'docs/install-rc3.md', 'docs/install-rc5.md', 'docs/rollback.md', 'docs/release.md']) {
    const text = readDoc(path)
    assert.match(text, /\]\(<?(?:docs\/)?install-desktop\.md>?\)/, path)
    assert.doesNotMatch(text, /^\s*dsh\s+plugin\s+--profile\s+desktop\b/m, path)
  }
  const runbook = readDoc('docs/install-desktop.md')
  assert.match(runbook, /managed exclusively by the Electron application/)
  assert.match(runbook, /not-bundle/)
  assert.match(runbook, /enabled: false/)
  for (const slug of slugs) assert.ok(runbook.includes(`'@deepseek-ai/dsh-client-${slug}'`))
})

test('fork payloads are installed as profile dependencies, never bundled or fetched as subdependencies', () => {
  assert.match(manifest.version, /^0\.(?:[3-9]|\d{2})\.\d+$/)
  for (const slug of slugs) {
    const name = '@deepseek-ai/dsh-client-' + slug
    // A registry/file/URL dependency would either install the stock module or a URL subdependency.
    assert.equal(manifest.dependencies[name], undefined, `${name} must not be a package dependency`)
  }
  assert.equal(manifest.bundledDependencies, undefined)
  for (const value of Object.values(manifest.dependencies)) assert.doesNotMatch(value, /^(?:file:|https?:|npm:|[A-Za-z]:|\/)/)
  assert.ok(!manifest.files.some(entry => /payload|forks/.test(entry)), 'no fork payload may ship in the tarball')
})

test('package scope and original native option IDs are kept for bundled fork resolution', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-session-query'], '>=0.2.0-rc.2 <0.3.0-0')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-storage-domain'], '>=0.2.0-rc.2 <0.3.0-0')
  // Native package names: the profile resolves them at its root, where the fork-library archives are
  // installed with publicHoistPattern. Subpath rows and nested Loader groups do not compose on 0.2.1.
  assert.doesNotMatch(patch, /fork-layer|group: true|payload\//)
  for (const slug of slugs) {
    assert.ok(patch.includes(`name: '@deepseek-ai/dsh-client-${slug}'`), `${slug}: native row missing`)
  }
  for (const id of ['ui-input-trigger', 'ui-commands', 'ui-conversation']) {
    assert.ok(patch.includes(`- id: ${id}\n  disabled: true`))
    assert.match(patch, new RegExp(`    - id: ${id}\\n      name:`))
  }
})

test('public npm file allowlist excludes private profiles, runtime logs and workflow data', () => {
  for (const entry of manifest.files) assert.doesNotMatch(entry, /sandbox|releases|profiles|backups|\.claw|node_modules|\.npmrc|\.env/)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/')
})

test('the published package carries installation instructions and matching root lock versions', () => {
  assert.ok(manifest.files.includes('docs/install.md'))
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  assert.equal(lock.version, manifest.version)
  assert.equal(lock.packages[''].version, manifest.version)
})

test('rc.3 public instructions retain the immutable seven-package release', () => {
  const install = readFileSync(new URL('../docs/install-rc3.md', import.meta.url), 'utf8')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(manifest.files.includes('docs/install-rc3.md'))
  assert.ok(install.includes('dsh-v0.2.2-rc.3-tasks-v0.4.8'))
  assert.ok(install.includes('veewo-dsh-better-tasks-0.4.8.tgz'))
  for (const slug of slugs) assert.ok(install.includes(`deepseek-ai-dsh-client-${slug}-0.2.2-rc.3.tgz`))
  for (const item of ['release-manifest.json', 'SHA256SUMS.txt', 'validation.json', 'nodeLinker: isolated']) assert.ok(install.includes(item))
  assert.ok(readme.includes('docs/install-rc3.md'))
})

test('installation and README select a DSH-first combined release, not npm latest', () => {
  const install = readFileSync(new URL('../docs/install.md', import.meta.url), 'utf8')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  // Public rc.2 release is immutable; a newer rc.3 candidate need not be public yet.
  const tag = 'dsh-v0.2.2-rc.2-tasks-v0.4.1'
  for (const doc of [install, readme]) {
    assert.ok(doc.includes(tag))
    assert.ok(doc.includes('release-manifest.json'))
    assert.ok(doc.includes('SHA256SUMS.txt'))
  }
  assert.ok(install.includes('veewo-dsh-better-tasks-0.4.1.tgz'))
  for (const slug of slugs) assert.ok(install.includes(`deepseek-ai-dsh-client-${slug}-0.2.2-rc.2.tgz`))
  assert.match(install, /nodeLinker: isolated/)
  assert.match(install, /autoInstallPeers: false/)
})

test('rc.5 installation uses its exact immutable GitHub composition', () => {
  const install = readFileSync(new URL('../docs/install-rc5.md', import.meta.url), 'utf8')
  assert.ok(manifest.files.includes('docs/install-rc5.md'))
  assert.ok(install.includes('dsh-v0.2.2-rc.5-tasks-v0.4.9'))
  assert.ok(install.includes('veewo-dsh-better-tasks-0.4.9.tgz'))
  assert.ok(install.includes('nodeLinker: isolated'))
})
