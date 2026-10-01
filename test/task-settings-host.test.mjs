import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { TASK_SETTINGS_DEFAULTS, TASK_SETTINGS_NAMESPACE, TaskSettingsSchema } from '../src/index.js'

const sourceUrl = new URL('../src/index.js', import.meta.url)
// Modern 0.2 Schemastery exposes volatile values as get()-backed cells; the
// Loader consumes their materialized values. Retained 0.1.5 fixtures were plain.
const resolveSettings = input => Object.fromEntries(Object.entries(TaskSettingsSchema(input)).map(([key, value]) => [key, typeof value?.get === 'function' ? value.get() : value]))

test('Better Tasks settings schema resolves the intended durable defaults', () => {
  assert.equal(TASK_SETTINGS_NAMESPACE, 'better-tasks-ui')
  assert.deepEqual(resolveSettings({}), TASK_SETTINGS_DEFAULTS)
  assert.deepEqual(resolveSettings({ detailFontSize: 16, columnLayout: 'double' }), {
    ...TASK_SETTINGS_DEFAULTS,
    detailFontSize: 16,
    columnLayout: 'double',
  })
  assert.throws(() => TaskSettingsSchema({ detailFontSize: 17 }))
  assert.deepEqual(resolveSettings({ titleEmphasis: 'task' }), { ...TASK_SETTINGS_DEFAULTS, titleEmphasis: 'task' })
  assert.throws(() => TaskSettingsSchema({ titleEmphasis: 'session' }))
  assert.throws(() => TaskSettingsSchema({ columnLayout: 'wide' }))
})

test('desktop settings can project every preference as an editable volatile field', () => {
  for (const field of Object.keys(TASK_SETTINGS_DEFAULTS)) {
    assert.equal(TaskSettingsSchema.dict[field].meta.volatile, true, field)
  }
})

test('Host settings registration stays optional to Better Tasks startup', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  assert.doesNotMatch(source, /export const inject = \[[^\]]*['"]settings['"]/)
  assert.match(source, /ctx\.inject\(\['settings'\], \(settingsCtx\) => \{/)
  assert.match(source, /settingsCtx\.settings\.register\(TASK_SETTINGS_NAMESPACE, TaskSettingsSchema\)/)
})
