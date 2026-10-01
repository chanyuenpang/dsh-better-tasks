import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const bundleUrl = new URL('../lib/client.js', import.meta.url)

test('generated browser bundle registers and materializes without executing UI globals', async () => {
  const source = await readFile(bundleUrl, 'utf8')
  let registration
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) { registration = value },
      },
    },
    Object,
    Map,
    Set,
    Date,
    Number,
    String,
    Error,
  }
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  assert.equal(registration.id, '@veewo/dsh-better-tasks')
  assert.match(source, /async function continueIdleTask\(/)
  assert.match(source, /async function renameTaskSession\(/)
  assert.doesNotMatch(source, /import .*task-actions\.mjs/)
  assert.match(source, /function createTaskInputManager\(/)
  assert.match(source, /conversation\.input\.createSurface\(/)
  assert.match(source, /sender\.sendSession\(session, message, \[\], 'steer', sendSignal\)/)
  assert.doesNotMatch(source, /import .*task-input-surface\.mjs/)
  assert.doesNotMatch(source, /listSkills\(sessionId/)
  const plugin = registration.factory((request) => {
    throw new Error(`unexpected eager module request: ${request}`)
  })
  assert.equal(plugin.name, 'dsh-better-tasks')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'layout', 'locale'])
  assert.equal(plugin.contract.childSlots.length, 6)
})
