import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const slugs = ['ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation']

test('public Desktop bundle resolves every audited fork through fixed repository URLs, never machine paths', () => {
  assert.equal(manifest.version, '0.3.0')
  for (const slug of slugs) {
    assert.equal(manifest.dependencies['@deepseek-ai/dsh-client-' + slug], `https://github.com/chanyuenpang/dsh-better-tasks/releases/download/better-tasks-forks-0.2.0-rc.2-r1/deepseek-ai-dsh-client-${slug}-0.2.0-rc.2.tgz`)
  }
  for (const value of Object.values(manifest.dependencies)) assert.doesNotMatch(value, /^(?:file:|[A-Za-z]:|\/)/)
})

test('public package is an installable removable bundle with the tested native peer baseline', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-session-query'], '0.2.0-rc.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-storage-domain'], '0.2.0-rc.2')
  for (const row of ['ui-layout', 'ui-sidebar', 'ui-workspace', 'ui-user-questions']) assert.ok(patch.includes(`- id: ${row}\n  disabled: true`))
  assert.match(patch, /id: better-tasks-ui\n\s+name: '@veewo\/dsh-better-tasks'/)
})

test('public npm file allowlist excludes private profiles, runtime logs and workflow data', () => {
  for (const entry of manifest.files) assert.doesNotMatch(entry, /sandbox|releases|profiles|backups|\.claw|node_modules|\.npmrc|\.env/)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.ok(manifest.files.includes('docs/release.md'))
  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/')
})
