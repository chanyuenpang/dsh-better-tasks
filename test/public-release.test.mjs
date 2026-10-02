import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

test('public Desktop package bundles the six native identities without exotic subdependency specs', () => {
  assert.equal(manifest.version, '0.3.1')
  for (const slug of slugs) {
    const name = '@deepseek-ai/dsh-client-' + slug
    assert.equal(manifest.dependencies[name], '0.2.0-rc.2')
    assert.ok(manifest.bundledDependencies.includes(name))
  }
  for (const value of Object.values(manifest.dependencies)) assert.doesNotMatch(value, /^(?:file:|https?:|npm:|[A-Za-z]:|\/)/)
})

test('package scope and original native option IDs are kept for bundled fork resolution', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-session-query'], '0.2.0-rc.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-storage-domain'], '0.2.0-rc.2')
  assert.equal(manifest.exports['./fork-layer'], './src/fork-layer.mjs')
  assert.match(patch, /name: '@veewo\/dsh-better-tasks\/fork-layer'\n\s+group: true/)
  for (const slug of slugs) assert.ok(patch.includes(`name: '@deepseek-ai/dsh-client-${slug}'`))
  for (const id of ['ui-input-trigger', 'ui-commands', 'ui-conversation']) {
    assert.ok(patch.includes(`- id: ${id}\n  disabled: true`))
    assert.match(patch, new RegExp(`        - id: ${id}\\n          name:`))
  }
})

test('public npm file allowlist excludes private profiles, runtime logs and workflow data', () => {
  for (const entry of manifest.files) assert.doesNotMatch(entry, /sandbox|releases|profiles|backups|\.claw|node_modules|\.npmrc|\.env/)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/')
})
