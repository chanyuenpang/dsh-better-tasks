import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createCardFinalExpansionController, isTaskCardFinalShortcutTarget, expandFinalForIdleCycles } from '../src/client.js'

const task = (id = 's', updatedAt = 10, status = 'idle') => ({ id, updatedAt, session: { status } })
const payload = (id = 's', text = 'Final answer') => ({ sessionId: id, final: text === null ? null : { text } })
function fixture({ cached, readFinal = async () => payload(), expanded = false } = {}) {
  const tasks = new Map([['s', task()]])
  const cache = new Map(cached ? [['s', cached]] : [])
  const writes = [], closes = [], reads = []
  const op = createCardFinalExpansionController({
    getTask: id => tasks.get(id), getCached: id => cache.get(id), isExpanded: () => expanded,
    readFinal: (request, signal) => { reads.push({ request, signal }); return readFinal(request, signal) },
    onReady: (request, value) => cache.set(request.id, { status: 'ready', updatedAt: request.updatedAt, value }),
    expand: id => { writes.push(id); expanded = true },
    collapse: id => { closes.push(id); expanded = false },
  })
  return { op, tasks, cache, writes, closes, reads, visible: () => expanded, setVisible: value => { expanded = value } }
}
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('current cached Final gestures alternate open, close, and open without another read', async () => {
  const f = fixture({ cached: { status: 'ready', updatedAt: 10, value: payload() } })
  const result = f.op.request('s')
  assert.deepEqual(f.writes, ['s'])
  assert.equal(await result, true)
  assert.equal(f.visible(), true)
  const close = f.op.request('s')
  assert.equal(f.visible(), false) // Synchronous close, before awaiting settlement.
  assert.equal(await close, true)
  assert.deepEqual(f.closes, ['s'])
  assert.equal(await f.op.request('s'), true)
  assert.equal(f.visible(), true)
  assert.deepEqual(f.writes, ['s', 's'])
  assert.equal(f.reads.length, 0)
})

test('collapsed uncached Final is read lazily and opens only after presence is confirmed', async () => {
  const d = defer(), f = fixture({ readFinal: () => d.promise })
  const pending = f.op.request('s')
  assert.deepEqual(f.writes, [])
  await Promise.resolve()
  assert.equal(f.reads.length, 1)
  d.resolve(payload())
  assert.equal(await pending, true)
  assert.deepEqual(f.writes, ['s'])
  assert.equal(f.cache.get('s').status, 'ready')
})

for (const text of [null, '', ' \n\t']) {
  test(`no usable Final (${JSON.stringify(text)}) leaves disclosure unchanged`, async () => {
    for (const cached of [undefined, { status: 'ready', updatedAt: 10, value: payload('s', text) }]) {
      const f = fixture({ cached, readFinal: async () => payload('s', text) })
      assert.equal(await f.op.request('s'), false)
      assert.deepEqual(f.writes, [])
    }
  })
}

test('outdated cache is not opened and matching in-flight gestures share one read', async () => {
  const d = defer(), f = fixture({ cached: { status: 'ready', updatedAt: 9, value: payload() }, readFinal: () => d.promise })
  const first = f.op.request('s'), second = f.op.request('s')
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(f.reads.length, 1)
  d.resolve(payload('s', 'fresh'))
  assert.equal(await first, true)
  assert.equal(f.cache.get('s').value.final.text, 'fresh')
})

test('running, blocked, or missing cards make no request and do not change disclosure', async () => {
  for (const status of ['running', 'block', 'missing']) {
    for (const expanded of [false, true]) {
      const f = fixture({ expanded })
      if (status === 'missing') f.tasks.clear()
      else f.tasks.set('s', task('s', 10, status))
      assert.equal(await f.op.request('s'), false)
      assert.equal(f.reads.length, 0)
      assert.deepEqual(f.writes, [])
      assert.deepEqual(f.closes, [])
    }
  }
})

test('expanded idle Final closes without fetching even when its content is absent, loading or failed', async () => {
  for (const cached of [undefined, { status: 'loading' }, { status: 'error' }, { status: 'ready', updatedAt: 10, value: payload('s', null) }]) {
    const f = fixture({ expanded: true, cached, readFinal: () => { throw new Error('close must never read') } })
    assert.equal(await f.op.request('s'), true)
    assert.equal(f.visible(), false)
    assert.equal(f.reads.length, 0)
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.closes, ['s'])
  }
})

test('double-click close invalidates an older shortcut read and refuses its late response', async () => {
  const d = defer(), f = fixture({ readFinal: () => d.promise })
  const pending = f.op.request('s')
  await Promise.resolve()
  f.setVisible(true)
  assert.equal(await f.op.request('s'), true)
  assert.equal(f.visible(), false)
  assert.equal(f.reads[0].signal.aborted, true)
  d.resolve(payload())
  assert.equal(await pending, false)
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.closes, ['s'])
  assert.equal(f.cache.size, 0)
})

for (const change of ['freshness', 'running', 'unpin', 'manual-toggle', 'unmount']) {
  test(`late Final cannot expand after ${change}`, async () => {
    const d = defer(), f = fixture({ readFinal: () => d.promise })
    const pending = f.op.request('s')
    await Promise.resolve()
    if (change === 'freshness') f.tasks.set('s', task('s', 11))
    if (change === 'running') f.tasks.set('s', task('s', 10, 'running'))
    if (change === 'unpin') f.tasks.clear()
    if (change === 'manual-toggle') f.op.cancel('s')
    if (change === 'unmount') f.op.dispose()
    f.op.reconcile()
    assert.equal(f.reads[0].signal.aborted, true)
    d.resolve(payload()) // A transport ignoring abort must still not publish.
    assert.equal(await pending, false)
    assert.deepEqual(f.writes, [])
    assert.equal(f.cache.size, 0)
  })
}

test('a stale response is rejected even before the reconcile effect runs', async () => {
  const d = defer(), f = fixture({ readFinal: () => d.promise })
  const pending = f.op.request('s')
  await Promise.resolve()
  f.tasks.set('s', task('s', 11))
  d.resolve(payload())
  assert.equal(await pending, false)
  assert.deepEqual(f.writes, [])
})

test('unpin/repin of the same Session invalidates the previous gesture', async () => {
  const d = defer(), f = fixture({ readFinal: () => d.promise })
  const pending = f.op.request('s')
  await Promise.resolve()
  f.tasks.clear(); f.op.reconcile(); f.tasks.set('s', task())
  d.resolve(payload())
  assert.equal(await pending, false)
  assert.deepEqual(f.writes, [])
})

test('failure or malformed/wrong-session payload does not expand; failure remains retryable', async () => {
  for (const readFinal of [async () => { throw new Error('HTTP 500') }, () => { throw new Error('sync failure') }, async () => payload('other'), async () => ({ sessionId: 's', final: {} })]) {
    const f = fixture({ readFinal })
    assert.equal(await f.op.request('s'), false)
    assert.equal(await f.op.request('s'), false)
    assert.deepEqual(f.writes, [])
    assert.equal(f.reads.length, 2)
  }
})

test('shortcut target excludes native controls, Final body, Markdown links and input surfaces', () => {
  assert.equal(isTaskCardFinalShortcutTarget({ closest: () => null }), true)
  for (const tag of ['button', 'a', 'input', 'textarea', 'select', '[data-no-card-drag]', '[contenteditable="true"]', '[role="button"]', '[role="switch"]']) {
    assert.equal(isTaskCardFinalShortcutTarget({ closest: selector => selector.split(',').includes(tag) ? {} : null }), false, tag)
  }
})

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const article = source.indexOf("return element('article'")
const clickStart = source.indexOf('onClick: (event) => {', article)
const clickEnd = source.indexOf('onDragStart:', clickStart)
const clickSource = source.slice(clickStart + 'onClick: '.length, clickEnd).trim().replace(/,$/, '')
function clickHarness({ target = { closest: () => null }, dragging = false, origin = false } = {}) {
  const opened = [], requested = []
  const dragOriginGuard = { current: origin ? 's' : null }
  const click = vm.runInNewContext(`(${clickSource})`, {
    task: task(), dragOriginGuard, dragClickGuard: { current: dragging ? 's' : null },
    openSession: id => opened.push(id), cardFinalRequests: { current: { request: id => requested.push(id) } },
    isTaskCardFinalShortcutTarget,
  })
  return { click: detail => click({ detail, target }), opened, requested }
}

test('actual card single-click still opens immediately, second click adds only the Final gesture', () => {
  const h = clickHarness()
  h.click(1)
  assert.deepEqual(h.opened, ['s']); assert.deepEqual(h.requested, [])
  h.click(2)
  assert.deepEqual(h.opened, ['s', 's']); assert.deepEqual(h.requested, ['s'])
  h.click(3); h.click(0)
  assert.deepEqual(h.requested, ['s'])
})

test('actual card click guards keep nested controls and drag gestures out of the shortcut', () => {
  for (const options of [{ dragging: true }, { origin: true }, { target: { closest: () => ({}) } }]) {
    const h = clickHarness(options)
    h.click(2)
    assert.deepEqual(h.opened, []); assert.deepEqual(h.requested, [])
  }
})

const changeStart = source.indexOf('    const changeFinalDisclosure = ')
const changeEnd = source.indexOf('    const operation = createCardFinalExpansionController(', changeStart)
const changeSource = source.slice(changeStart, changeEnd)

function disclosureHarness(initialCycles, initialExpanded) {
  let cycles = initialCycles, expanded = initialExpanded
  const canceled = []
  const change = vm.runInNewContext(`${changeSource}\nchangeFinalDisclosure`, {
    finalShortcutState: { current: { tasks: new Map([['s', { ...task(), current: false }]]), finalAutoCycles: initialCycles } },
    finalClicks: { current: { cancel: id => canceled.push(id) } },
    setFinalAutoCycles: update => { cycles = update(cycles) },
    setExpanded: update => { expanded = update(expanded) },
    expandFinalForIdleCycles,
  })
  return { change, canceled, cycles: () => cycles, expanded: () => expanded }
}

test('actual close callback cancels Final-body timer and preserves same-cycle input/Goal/Todo choices', () => {
  const existing = { 's:final': true, 's:input': true, 's:goal': true, 's:todo': false }
  const h = disclosureHarness({ s: 10 }, existing)
  h.change('s', false)
  assert.deepEqual(h.canceled, ['s'])
  assert.equal(h.expanded()['s:final'], false)
  for (const field of ['input', 'goal', 'todo']) assert.equal(h.expanded()[`s:${field}`], existing[`s:${field}`])
  h.change('s', true)
  assert.equal(h.expanded()['s:final'], true)
  assert.equal(h.expanded()['s:input'], true)
})

test('manual closing before background cycle persistence cannot be erased by cycle reconciliation or restart', () => {
  const h = disclosureHarness({}, {})
  h.change('s', false)
  assert.equal(h.cycles().s, 10)
  const reconciled = expandFinalForIdleCycles(h.cycles(), [task()], h.expanded())
  assert.equal(reconciled.expanded['s:final'], false)
  const restart = expandFinalForIdleCycles(JSON.parse(JSON.stringify(h.cycles())), [task('s', 1)], JSON.parse(JSON.stringify(h.expanded())))
  assert.equal(restart.expanded['s:final'], false)
})

test('card shortcut does not toggle input or replace the existing Final-body double-click', () => {
  assert.match(clickSource, /event\.detail === 2 && isTaskCardFinalShortcutTarget/)
  assert.doesNotMatch(clickSource, /toggleProjection|setTimeout|onDoubleClick/)
  assert.match(source, /if \(key === 'final'\) cardFinalRequests\.current\?\.cancel\(sessionId\)/)
  assert.match(source, /event\.detail === 2 && finalClicks\.current\.doubleClick\(task\.id/)
  assert.match(source, /cardFinalRequests\.current\?\.reconcile\(\)/)
  assert.match(source, /operation\.dispose\(\)/)
})
