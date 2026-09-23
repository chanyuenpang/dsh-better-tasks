import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const sourceUrl = new URL('../forks/ui-user-questions/lib/client.js', import.meta.url)

function materialize(source) {
  let descriptor
  const styles = []
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild: (style) => styles.push(style) },
  }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (value) => { descriptor = value } } },
    document,
    console,
    Error,
    Promise,
    Object,
    Map,
    Set,
    Symbol,
  })
  assert.ok(descriptor)
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const createStore = (definition) => {
    let state = definition.init()
    const listeners = new Set()
    return {
      getSnapshot: () => state,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      actions: Object.fromEntries(Object.entries(definition.actions).map(([name, reduce]) => [name, (...args) => {
        const next = { ...state }
        reduce(next, ...args)
        state = next
        for (const listener of listeners) listener()
      }])),
    }
  }
  const require = (id) => {
    if (id === '@deepseek-ai/dsh-client-store') return { defineStore: (definition) => ({ create: () => createStore(definition) }) }
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('react.fragment') }
    if (id === 'react') return {}
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`unexpected module ${id}`)
  }
  return { plugin: descriptor.factory(require), styles }
}

test('exact question fork keeps one canonical owner and publishes an optional surface', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  assert.equal(source.split('id: "@deepseek-ai/dsh-client-ui-user-questions"').length - 1, 1)
  assert.equal(source.split('ctx.slots.inject("conversation.composer"').length - 1, 1)
  assert.equal(source.split('ctx.remote.$on("user-questions/request"').length - 1, 1)
  assert.match(source, /ctx\.reflect\.provide\("questionSurface", questionSurface\)/)
  assert.match(source, /createQuestionDraftStore\(\)\.create\(\)/)
  assert.match(source, /if \(!this\.lock\(record\)\)/)
  assert.match(source, /registry\.forget\(pending\)/)
  assert.match(source, /style\.remove\(\)/)
})

test('surface service recognizes only official carriers and preserves waterfall settlement', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  const { plugin } = materialize(source)
  const disposers = []
  let service
  let remoteHandler
  let pending
  let removes = 0
  const ctx = {
    effect(factory) { const dispose = factory(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
    locale: { register: () => () => {}, bind: () => (key) => key },
    reflect: { provide(name, value) { assert.equal(name, 'questionSurface'); service = value; return () => { service = undefined } } },
    sessions: { scopeOf: () => 'session-test' },
    uiSession: { registerPendingInteraction: () => (value) => { pending = value; return () => { removes += 1 } } },
    slots: { inject: (_name, register) => register(), register: () => () => {} },
    remote: { $on: (_name, handler) => { remoteHandler = handler; return () => {} } },
  }
  plugin.apply(ctx)
  assert.ok(service)
  assert.equal(service.isSupported({ kind: 'question' }), false)
  assert.equal(service.render({ kind: 'question' }), null)

  const request = remoteHandler.call({}, {
    questions: [{ id: 'mode', header: 'Mode', question: 'Choose', options: [{ label: 'Safe' }] }],
  }, () => { throw new Error('unexpected delegation') })
  assert.ok(pending)
  assert.equal(service.isSupported(pending), true)
  const rendered = service.render(pending, 'task-card')
  assert.equal(typeof rendered.type, 'function')
  assert.equal(rendered.props.pending, pending)
  assert.equal(rendered.props.variant, 'task-card')

  const answer = { answers: [{ id: 'mode', selected: ['Safe'] }] }
  await pending.answer(answer)
  assert.deepEqual(await request, answer)
  assert.equal(removes, 1)
  await assert.rejects(() => pending.answer(answer), /already settled/)

  for (const dispose of disposers.reverse()) dispose()
  assert.equal(service, undefined)
})
