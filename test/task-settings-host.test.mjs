import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { TASK_SETTINGS_DEFAULTS, TASK_SETTINGS_NAMESPACE, TaskSettingsSchema } from '../src/index.js'

const sourceUrl = new URL('../src/index.js', import.meta.url)

test('Better Tasks settings schema resolves the intended durable defaults', () => {
  assert.equal(TASK_SETTINGS_NAMESPACE, 'better-tasks-ui')
  assert.deepEqual(TaskSettingsSchema({}), TASK_SETTINGS_DEFAULTS)
  assert.deepEqual(TaskSettingsSchema({ detailFontSize: 16, columnLayout: 'double' }), {
    ...TASK_SETTINGS_DEFAULTS,
    detailFontSize: 16,
    columnLayout: 'double',
  })
  assert.throws(() => TaskSettingsSchema({ detailFontSize: 17 }))
  assert.throws(() => TaskSettingsSchema({ columnLayout: 'wide' }))
})

test('Host settings registration stays optional to Better Tasks startup', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  assert.doesNotMatch(source, /export const inject = \[[^\]]*['"]settings['"]/)
  assert.match(source, /ctx\.inject\(\['settings'\], \(settingsCtx\) => \{/)
  assert.match(source, /settingsCtx\.settings\.register\(TASK_SETTINGS_NAMESPACE, TaskSettingsSchema\)/)
})
