import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { expandFinalForIdleCycles, isProjectionExpanded } from '../src/client.js'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const storageSource = source.slice(source.indexOf('function parseExpansionRecord('), source.indexOf('function useProjectAppearanceSnapshot(')).replace(/^export /gm, '')
const writeSource = source.slice(source.indexOf('function writeStorage('), source.indexOf('/**', source.indexOf('function writeStorage(')))
function harness(storage, getter = false) {
  let state, queuedEffect
  const context = {
    requireModule: () => ({
      useState(init) {
        state = typeof init === 'function' ? init() : init
        return [state, next => { state = typeof next === 'function' ? next(state) : next }]
      },
      useEffect(effect) { queuedEffect = effect },
    }),
  }
  if (getter) Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError: storage getter blocked') } })
  else if (storage !== undefined) context.localStorage = storage
  const api = vm.runInNewContext(`${writeSource}\n${storageSource}\n({loadStoredExpansion,useStoredExpansion,useStoredRecord})`, context)
  return { api, value: () => JSON.parse(JSON.stringify(state)), flush: () => queuedEffect?.() }
}
const storage = rows => ({ getItem: key => rows[key] ?? null, setItem: (key, value) => { rows[key] = value } })

test('Desktop localStorage absence, denied read, or denied property getter falls back to memory', () => {
  for (const h of [harness(undefined), harness({ getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') } }), harness(undefined, true)]) {
    const [, set] = h.api.useStoredExpansion('current', 'legacy')
    assert.deepEqual(h.value(), {})
    set(value => ({ ...value, 's:todo': true }))
    assert.deepEqual(h.value(), { 's:todo': true })
    assert.doesNotThrow(() => h.flush())
    h.api.useStoredRecord('cycles')
    assert.deepEqual(h.value(), {})
    assert.doesNotThrow(() => h.flush())
  }
})

test('malformed disclosure and cycle storage does not prevent initialization', () => {
  for (const bad of ['{bad', 'null', '[]', '42']) {
    const h = harness(storage({ current: bad, cycles: bad }))
    h.api.useStoredExpansion('current')
    assert.deepEqual(h.value(), {})
    h.api.useStoredRecord('cycles')
    assert.deepEqual(h.value(), {})
  }
})

test('existing disclosure values and cycle markers are read without writing during initialization', () => {
  const rows = { current: JSON.stringify({ 's:todo': false, 's:input': true, bad: 'true' }), cycles: JSON.stringify({ s: 10, other: 'goal-id', bad: false }) }
  const h = harness(storage(rows))
  h.api.useStoredExpansion('current')
  assert.deepEqual(h.value(), { 's:todo': false, 's:input': true })
  assert.equal(JSON.parse(rows.current).bad, 'true')
  h.flush()
  assert.deepEqual(JSON.parse(rows.current), { 's:todo': false, 's:input': true })
  h.api.useStoredRecord('cycles')
  assert.deepEqual(h.value(), { s: 10, other: 'goal-id' })
})

test('legacy disclosure migration remains limited to open Todo and leaves legacy storage intact', () => {
  const legacy = JSON.stringify({ 's:todo': true, 'b:todo': false, 's:goal': true, 's:input': true })
  const rows = { legacy }
  const h = harness(storage(rows))
  h.api.useStoredExpansion('current', 'legacy')
  assert.deepEqual(h.value(), { 's:todo': true })
  h.flush()
  assert.equal(rows.legacy, legacy)
  assert.deepEqual(JSON.parse(rows.current), { 's:todo': true })
})

test('a denied legacy read falls back safely instead of crashing a Desktop render', () => {
  const h = harness({ getItem(key) { if (key === 'legacy') throw new Error('denied'); return null }, setItem() {} })
  h.api.useStoredExpansion('current', 'legacy')
  assert.deepEqual(h.value(), {})
})

test('cycle markers retain enough entries to protect surviving disclosure overrides on refresh', () => {
  const rows = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`s${i}`, i]))
  const h = harness(storage({ cycles: JSON.stringify(rows) }))
  h.api.useStoredRecord('cycles')
  assert.equal(Object.keys(h.value()).length, 150)
  assert.equal(h.value().s0, 0)
})

test('a new renderer restores actual stored disclosure and cycle keys before cold-to-warm catalog reconciliation', () => {
  const disclosureKey = 'dsh-better-tasks.projection-expansion.v2'
  const cycleKey = 'dsh-better-tasks.final-auto-open-cycle.v1'
  const rows = {
    [disclosureKey]: JSON.stringify({ 'a:final': false, 'a:input': true, 'b:final': true }),
    [cycleKey]: JSON.stringify({ a: 100, b: 200 }),
  }
  const h = harness(storage(rows))
  h.api.useStoredExpansion(disclosureKey)
  const manual = h.value()
  h.api.useStoredRecord(cycleKey)
  const cycles = h.value()
  const cold = expandFinalForIdleCycles(cycles, [{ id: 'a', updatedAt: 10 }, { id: 'b', updatedAt: 20 }], manual)
  const warm = expandFinalForIdleCycles(cold.cycles, [{ id: 'a', updatedAt: 100 }, { id: 'b', updatedAt: 200 }], cold.expanded)
  assert.equal(isProjectionExpanded(warm.expanded, 'a:final', true), false)
  assert.equal(isProjectionExpanded(warm.expanded, 'b:final', false), true)
  assert.equal(warm.expanded['a:input'], true)
  assert.deepEqual(warm.cycles, { a: 100, b: 200 })
  assert.deepEqual(JSON.parse(rows[disclosureKey]), manual) // No restoration-time rewrite or clearing.
})

test('settings copy describes Final-gated idle input, lifecycle boundaries and question font sizing', () => {
  assert.match(source, /快速消息栏仅在空闲卡片的 Final 展开时显示/)
  assert.match(source, /quick message bar appears only on idle cards with Final expanded/)
  assert.match(source, /Todo、Goal、Final 的展开正文及任务卡问题区/)
  assert.match(source, /plus task-card questions/)
  assert.doesNotMatch(source, /'settings\.expansionHint': '各项互相独立/)
  assert.match(source, /ctx\.inject\(\['configForms'\], bindSettings\)/)
  assert.doesNotMatch(source, /export const inject = \[[^\]]*'configForms'/)
})
