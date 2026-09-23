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
  assert.equal(registration.id, 'dsh-better-tasks')
  const plugin = registration.factory((request) => {
    throw new Error(`unexpected eager module request: ${request}`)
  })
  assert.equal(plugin.name, 'dsh-better-tasks')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'layout', 'locale'])
  assert.equal(plugin.contract.childSlots.length, 6)
})
