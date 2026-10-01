import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskInputManager } from '../src/task-input-surface.mjs'
import { continueIdleTask } from '../src/task-actions.mjs'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
function store(draft) {
  let state = { draft }
  const listeners = new Set()
  return { getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    setDraft(value) { state = { draft: value }; for (const fn of listeners) fn() }, get listeners() { return listeners.size } }
}
function nativeHandle(options) {
  const completion = deferred(), state = store(options.initialDraft ?? ''), notices = []
  const handle = { sessionId: options.sessionId, View() {}, input: { notify: (...args) => notices.push(args) }, state,
    notices, closed: completion.promise, whenSettled: () => completion.promise, closeCount: 0,
    dispose() { handle.closeCount++ }, finish: completion.resolve, options }
  return handle
}
function bench() {
  const bindings = new Map(), statuses = new Map(), requests = [], handles = [], calls = [], pins = new Set(['s1', 's2'])
  let status = { running: false, pendingInteraction: null }, snapshot = { running: false, openState: 'open', removed: false }, goal = null
  let result
  for (const id of ['s1', 's2']) {
    const session = { sessionId: id, getSnapshot: () => snapshot,
      projections: { faceOf: () => ({ getSnapshot: () => ({ goal: { id: 'stale', revision: 1, phase: 'paused' } }) }) },
      rename: async title => { calls.push(['rename', id, title]); return { ok: true } },
      prompt: () => { throw new Error('must use native Conversation sender') },
    }
    bindings.set(id, { sessionId: id, session })
    statuses.set(id, status)
  }
  const sessions = { binding: id => bindings.get(id), async using(id, options, operation) {
    calls.push(['retain', id, options.source])
    try { return await operation({ ready: Promise.resolve(bindings.get(id)) }) }
    finally { calls.push(['release', id]) }
  } }
  const conversation = { input: { async createSurface(options) {
    requests.push(options)
    return result.factory(options)
  } }, sendSession: async (...args) => { calls.push(['send', ...args]); return result.send(...args) } }
  const goals = { get: async id => { calls.push(['getGoal', id]); return result.getGoal(id) }, resume: async (id, ref) => { calls.push(['resume', id, ref]); return result.resume(id, ref) } }
  result = { bindings, statuses, requests, handles, calls, pins, sessions, conversation, goals,
    factory: options => { const h = nativeHandle(options); handles.push(h); return h },
    send: async () => ({ kind: 'success' }), getGoal: async () => ({ ok: true, value: goal }), resume: async () => ({ ok: true }),
    setGoal: value => { goal = value }, setSnapshot: value => { snapshot = { ...snapshot, ...value } },
    setStatus: value => { status = { ...status, ...value }; statuses.set('s1', status); statuses.set('s2', status) },
  }
  result.manager = createTaskInputManager({ getConversation: () => conversation, getSessions: () => sessions,
    getStatus: () => statuses, getGoals: () => goals, isPinned: id => pins.has(id) })
  result.sink = (index = 0, text = 'continue', signal = new AbortController().signal) => {
    const h = handles[index]
    return h.options.defaultSink({ binding: bindings.get(h.sessionId), text, signal, attachmentIds: [], mode: 'queue' })
  }
  result.cleanup = async () => { result.manager.dispose(); for (const h of handles) h.finish(); await flush() }
  return result
}

test('native factory remains lazy, sends serialized text through native Conversation exactly once', async () => {
  const b = bench()
  assert.equal(b.requests.length, 0)
  const h = await b.manager.create('s2')
  assert.equal(h.View, b.handles[0].View)
  assert.equal(b.requests[0].sessionId, 's2')
  assert.equal(b.calls.length, 0)
  const signal = new AbortController().signal
  assert.deepEqual(await b.sink(0, '/some-skill work on @file', signal), { kind: 'success' })
  const send = b.calls[0]
  assert.deepEqual(send.slice(1), [b.bindings.get('s2').session, '/some-skill work on @file', [], 'steer', signal])
  assert.deepEqual(b.calls[1], ['getGoal', 's2'])
  await b.cleanup()
})

test('current UI status wins over deprecated pendingInteraction snapshot, checked at each admission', async () => {
  const b = bench()
  await b.manager.create('s1')
  b.setSnapshot({ pendingInteraction: { obsolete: true } })
  await b.sink()
  b.calls.length = 0
  b.setStatus({ pendingInteraction: { callId: 'q1' } })
  await assert.rejects(b.sink(), /no longer idle/)
  assert.equal(b.calls.length, 0)
  b.setStatus({ pendingInteraction: null, running: true })
  await assert.rejects(b.sink(), /no longer idle/)
  b.setStatus({ running: false }); b.setSnapshot({ running: true })
  await assert.rejects(b.sink(), /no longer idle/)
  assert.equal(b.calls.length, 0)
  await b.cleanup()
})

test('Goal fetch is after successful admission and resume uses fresh flattened CAS', async () => {
  const b = bench(), admission = deferred()
  b.send = () => admission.promise
  b.setGoal({ id: 'new-goal', revision: 8, phase: 'paused', activation: 'disarmed', roundsStarted: 2, maxGoalRounds: 6 })
  await b.manager.create('s1')
  const sent = b.sink()
  await flush()
  assert.deepEqual(b.calls.map(call => call[0]), ['send'])
  admission.resolve({ kind: 'success' }); await sent
  assert.deepEqual(b.calls.slice(1), [['getGoal', 's1'], ['resume', 's1', { id: 'new-goal', revision: 8 }]])
  await b.cleanup()
})

for (const goal of [null,
  { id: 'g', revision: 1, phase: 'complete', activation: 'disarmed', roundsStarted: 1, maxGoalRounds: 4 },
  { id: 'g', revision: 1, phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 4 }]) {
  test(`Goal ${goal?.phase ?? 'absent'}/${goal?.activation ?? '-'} does not resume`, async () => {
    const b = bench(); b.setGoal(goal); await b.manager.create('s1'); await b.sink()
    assert.equal(b.calls.some(call => call[0] === 'resume'), false)
    assert.deepEqual(b.handles[0].notices, [])
    await b.cleanup()
  })
}
for (const phase of ['active', 'paused', 'blocked']) {
  test(`eligible ${phase} disarmed Goal resumes after sending`, async () => {
    const b = bench(); b.setGoal({ id: 'g', revision: 2, phase, activation: 'disarmed', roundsStarted: 1, maxGoalRounds: 2 })
    await b.manager.create('s1'); await b.sink()
    assert.equal(b.calls.filter(call => call[0] === 'resume').length, 1)
    await b.cleanup()
  })
}

test('budget exhaustion and Goal transport errors only warn, even when warning callbacks throw', async () => {
  const b = bench(), warnings = []
  b.setGoal({ id: 'g', revision: 2, phase: 'blocked', activation: 'disarmed', roundsStarted: 2, maxGoalRounds: 2 })
  await b.manager.create('s1', { onWarning: text => { warnings.push(text); throw new Error('warning callback broke') } })
  b.handles[0].input.notify = () => { throw new Error('view gone') }
  assert.deepEqual(await b.sink(), { kind: 'success' })
  assert.match(warnings[0], /budget.*exhausted/)
  assert.equal(b.calls.some(call => call[0] === 'resume'), false)
  b.getGoal = async () => ({ ok: false, error: { message: 'Goal unavailable' } })
  assert.deepEqual(await b.sink(), { kind: 'success' })
  assert.equal(warnings[1], 'Goal unavailable')
  b.getGoal = async () => ({ ok: true, value: { id: 'g', revision: 3, phase: 'paused', activation: 'disarmed', roundsStarted: 1, maxGoalRounds: 2 } })
  b.resume = async () => ({ ok: false, error: { message: 'stale revision' } })
  assert.deepEqual(await b.sink(), { kind: 'success' })
  assert.equal(warnings[2], 'stale revision')
  assert.equal(b.calls.filter(call => call[0] === 'send').length, 3)
  await b.cleanup()
})

test('failed sender never queries or resumes a Goal', async () => {
  const b = bench(); b.send = async () => ({ kind: 'error', text: 'not admitted' })
  await b.manager.create('s1')
  await assert.rejects(b.sink(), /not admitted/)
  assert.deepEqual(b.calls.map(call => call[0]), ['send'])
  await b.cleanup()
})

test('closing UI does not replace admitted operation signal and still reports global Goal warning', async () => {
  const b = bench(), delivery = deferred(), warnings = [], abort = new AbortController(), attempt = new AbortController()
  b.send = () => delivery.promise
  b.getGoal = async () => ({ ok: false, error: { message: 'Goal warning after close' } })
  await b.manager.create('s1', { signal: abort.signal, onWarning: text => warnings.push(text) })
  const sent = b.sink(0, 'continue', attempt.signal)
  abort.abort(new Error('card unmounted'))
  assert.equal(b.requests[0].signal.aborted, true)
  assert.equal(attempt.signal.aborted, false)
  delivery.resolve({ kind: 'success' }); assert.deepEqual(await sent, { kind: 'success' })
  assert.deepEqual(warnings, ['Goal warning after close'])
  await b.cleanup()
})

test('same Session cannot share a live View; reopening waits for closed and late failure draft restoration', async () => {
  const b = bench(), first = await b.manager.create('s1')
  b.handles[0].state.setDraft('before send')
  await assert.rejects(b.manager.create('s1'), /already active/)
  first.dispose()
  const reopened = b.manager.create('s1')
  await flush(); assert.equal(b.requests.length, 1)
  b.handles[0].state.setDraft('late restored failure')
  assert.equal(b.handles[0].state.listeners, 1)
  b.handles[0].finish()
  const second = await reopened
  assert.equal(b.requests[1].initialDraft, 'late restored failure')
  assert.equal(b.handles[0].state.listeners, 0)
  b.handles[1].state.setDraft('new editor draft')
  b.handles[0].state.setDraft('obsolete late callback')
  second.dispose(); b.handles[1].finish(); await flush()
  await b.manager.create('s1')
  assert.equal(b.requests[2].initialDraft, 'new editor draft')
  await b.cleanup()
})

test('aborting a reopening wait does not cancel predecessor settlement or create another native handle', async () => {
  const b = bench(), first = await b.manager.create('s1'), abort = new AbortController()
  first.dispose()
  const waiting = b.manager.create('s1', { signal: abort.signal })
  abort.abort(new Error('left while waiting'))
  await assert.rejects(waiting, /left while waiting/)
  assert.equal(b.requests.length, 1)
  b.handles[0].state.setDraft('restored'); b.handles[0].finish(); await flush()
  await b.manager.create('s1')
  assert.equal(b.requests[1].initialDraft, 'restored')
  await b.cleanup()
})

test('early abort and late factory success are cleaned without leaking or duplicate creation', async () => {
  const b = bench(), factory = deferred(), abort = new AbortController()
  b.factory = () => factory.promise
  const creating = b.manager.create('s1', { signal: abort.signal })
  await flush()
  await assert.rejects(b.manager.create('s1'), /already active/)
  abort.abort(new Error('early abort'))
  await assert.rejects(creating, /early abort/)
  const late = nativeHandle(b.requests[0]); b.handles.push(late); factory.resolve(late); await flush()
  assert.equal(late.closeCount, 1)
  assert.equal(late.state.listeners, 1)
  late.finish(); await flush()
  assert.equal(late.state.listeners, 0)
  b.factory = options => { const h = nativeHandle(options); b.handles.push(h); return h }
  await b.manager.create('s1')
  await b.cleanup()
})

test('unpin during closing prevents late restored draft from resurrecting on repin', async () => {
  const b = bench(), h = await b.manager.create('s1')
  b.handles[0].state.setDraft('old draft')
  b.pins.delete('s1'); h.dispose(); b.handles[0].state.setDraft('late draft'); b.handles[0].finish(); await flush()
  await assert.rejects(b.manager.create('s1'), /no longer pinned/)
  b.pins.add('s1'); await b.manager.create('s1')
  assert.equal(b.requests[1].initialDraft, undefined)
  await b.cleanup()
})

test('manager disposal closes only owned surfaces and refuses later creation', async () => {
  const b = bench(), a = await b.manager.create('s1'), c = await b.manager.create('s2')
  let mainClosed = false
  b.conversation.main = { dispose: () => { mainClosed = true } }
  b.manager.dispose(); b.manager.dispose()
  assert.equal(b.handles[0].closeCount, 1); assert.equal(b.handles[1].closeCount, 1)
  assert.equal(mainClosed, false)
  await assert.rejects(b.manager.create('s1'), /disposed/)
  a.dispose(); c.dispose()
  await b.cleanup()
})

test('retained rename awaits ready, trims title, and keeps lease through mutation', async () => {
  const b = bench(), ready = deferred(), mutation = deferred()
  b.sessions.using = async (id, options, operation) => {
    b.calls.push(['retain', id, options.source])
    try { await ready.promise; return await operation({ ready: ready.promise }) }
    finally { b.calls.push(['release', id]) }
  }
  b.bindings.get('s1').session.rename = title => { b.calls.push(['rename', title]); return mutation.promise }
  const renamed = b.manager.rename('s1', '  next title  ')
  await flush(); assert.deepEqual(b.calls.map(call => call[0]), ['retain'])
  ready.resolve(b.bindings.get('s1')); await flush()
  assert.deepEqual(b.calls.map(call => call[0]), ['retain', 'rename'])
  assert.deepEqual(b.calls[1], ['rename', 'next title'])
  mutation.resolve({ ok: true }); await renamed
  assert.equal(b.calls.at(-1)[0], 'release')
  await b.cleanup()
})

test('rename validates changed readiness and removed/generation state before mutation', async () => {
  for (const state of [{ openState: 'failed' }, { removed: true }, 'generation']) {
    const b = bench(), ready = deferred()
    b.sessions.using = async (_id, _options, operation) => operation({ ready: ready.promise })
    const before = b.bindings.get('s1'), pending = b.manager.rename('s1', 'name')
    if (state === 'generation') b.bindings.set('s1', { ...before })
    else b.setSnapshot(state)
    ready.resolve(before)
    await assert.rejects(pending, /unavailable|generation changed/)
    assert.equal(b.calls.some(call => call[0] === 'rename'), false)
    await b.cleanup()
  }
})

test('rename fallback retains and releases even when readiness rejects', async () => {
  const b = bench()
  delete b.sessions.using
  let released = 0
  b.sessions.retain = () => ({ ready: Promise.reject(new Error('open failed')), release: () => { released++ } })
  await assert.rejects(b.manager.rename('s1', 'new'), /open failed/)
  assert.equal(released, 1)
  await b.cleanup()
})

test('per-Session status getter matches the client adapter shape', async () => {
  const b = bench(), queried = [], calls = []
  const current = b.bindings.get('s1')
  b.setSnapshot({ pendingInteraction: { obsolete: true } })
  const getStatus = id => { queried.push(id); return { running: false, pendingInteraction: null } }
  assert.deepEqual(await continueIdleTask({ binding: current, text: 'native', getStatus,
    goals: { get: async () => ({ ok: true, value: null }) },
    submit: async args => { calls.push(args); return { kind: 'success' } } }), { warning: null })
  assert.deepEqual(queried, ['s1'])
  assert.equal(calls[0].text, 'native')
  await b.cleanup()
})

test('failed native creation clears its ownership reservation so retry can succeed', async () => {
  const b = bench()
  b.factory = async () => { throw new Error('native providers missing') }
  await assert.rejects(b.manager.create('s1'), /native providers missing/)
  b.factory = options => { const h = nativeHandle(options); b.handles.push(h); return h }
  await b.manager.create('s1')
  assert.equal(b.requests.length, 2)
  await b.cleanup()
})

test('already-aborted creation never calls native factory or acquires task ownership', async () => {
  const b = bench(), abort = new AbortController()
  abort.abort(new Error('already left'))
  await assert.rejects(b.manager.create('s1', { signal: abort.signal }), /already left/)
  assert.equal(b.requests.length, 0)
  await b.manager.create('s1')
  await b.cleanup()
})

test('two reopening waiters cannot acquire the same Session after predecessor closes', async () => {
  const b = bench(), first = await b.manager.create('s1')
  first.dispose()
  const a = b.manager.create('s1'), c = b.manager.create('s1')
  b.handles[0].finish()
  const outcomes = await Promise.allSettled([a, c])
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
  assert.match(outcomes.find(outcome => outcome.status === 'rejected').reason.message, /already active/)
  assert.equal(b.requests.length, 2)
  await b.cleanup()
})

test('missing live status map refuses sending rather than trusting deprecated snapshot pending', async () => {
  const b = bench()
  await assert.rejects(continueIdleTask({ binding: b.bindings.get('s1'), text: 'continue', getStatus: () => undefined,
    submit: () => { throw new Error('must not submit') } }), /status is unavailable/)
  await b.cleanup()
})
