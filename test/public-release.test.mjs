import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

test('fork payloads are installed as profile dependencies, never bundled or fetched as subdependencies', () => {
  assert.equal(manifest.version, '0.3.2')
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
