import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const source = readFileSync(new URL('../src/fork-layer.mjs', import.meta.url), 'utf8')

test('bundled layer owns the EntryTree used by Host import and Client module metadata, not a parent Group tree', async () => {
  const url = new URL('../src/fork-layer.mjs', import.meta.url).href
  const code = source.replace(/^import .*\n/gm, '').replace('export default class', 'class').replace('import.meta.url', '__url')
  const updates = [], stopped = [], events = []
  const Service = { init: Symbol('init') }, EntryGroup = { key: Symbol.for('cordis.group') }
  class EntryTree {
    constructor(ctx) {
      this.ctx = { ...ctx, on: (name, fn) => events.push({ name, fn }) }
      this.root = { tree: this, update: async cfg => updates.push(cfg), stop: () => stopped.push(true) }
    }
  }
  const Layer = new Function('EntryTree', 'EntryGroup', 'Service', '__url', `${code}\nreturn BundledForkLayer`)(EntryTree, EntryGroup, Service, url)
  const config = [{ id: 'ui-conversation', name: '@deepseek-ai/dsh-client-ui-conversation', config: { busyEnter: 'queue' } }]
  const parentCtx = { baseUrl: 'file:///profile/' }
  const instance = new Layer(parentCtx, config)
  const entry = { parent: { tree: instance } }
  assert.equal(entry.parent.tree.ctx.baseUrl, new URL('../', url).href)
  assert.equal(parentCtx.baseUrl, 'file:///profile/')
  assert.equal(instance.root.tree, instance)
  assert.equal(Layer[EntryGroup.key], true)
  const init = instance[Service.init](), teardown = (await init.next()).value
  await init.next()
  assert.equal(updates[0], config)
  assert.equal(updates[0][0].id, 'ui-conversation')
  assert.equal(updates[0][0].config.busyEnter, 'queue')
  teardown()
  assert.deepEqual(stopped, [true])
  assert.equal(events[0].name, 'internal/update')
  assert.doesNotMatch(source, /provide\(|toggleSidebar|pinSession|createInputSurface|localStorage|settings/)
})
