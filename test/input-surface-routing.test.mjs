import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

// Exercise the actual fork sources without a bundle/build or a browser. Only
// infrastructure (Cordis/store/React view) is replaced; native controllers,
// directory, dispatch, popup and menu reducer run unchanged.
const root = resolve('.srcbuild/packages/client')
const store = (initial) => {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, set(next) { value = next; for (const fn of listeners) fn() }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
}
class Service { constructor(ctx) { this.ctx = ctx } }
class WeakMapWithValues {
  map = new Map()
  get(key) { return this.map.get(key) }
  set(key, value) { this.map.set(key, value) }
  delete(key) { return this.map.delete(key) }
  get values() { return [...this.map.values()] }
}
const externals = {
  '@deepseek-ai/cordis': { Service },
  '@deepseek-ai/dsh-util-values': { WeakMapWithValues },
  '@deepseek-ai/dsh-client-store': { createSnapshotStore: store },
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy({ rankByName: (rows, q) => rows.filter(row => `${row.name} ${row.label ?? ''}`.toLowerCase().includes(q.toLowerCase())) }, { get: (obj, key) => obj[key] ?? (() => null) }),
  '@deepseek-ai/dsh-file-reference/grammar': { activeAtToken: () => undefined },
}
const loaded = new Map()
function load(path) {
  path = resolve(path)
  if (loaded.has(path)) return loaded.get(path)
  if (path.endsWith('MenuView.tsx')) return { MenuView: () => null }
  if (path.endsWith('PopupSelectView.tsx')) return { PopupSelectView: () => null }
  let source = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform', sourceUrl: path })
  const deps = []
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, imports, name) => {
    const dependency = name.startsWith('.') ? load(resolve(dirname(path), name)) : externals[name]
    assert.ok(dependency, `test dependency stub missing: ${name}`)
    const index = deps.push(dependency) - 1
    return `const ${imports.trim().replace(/\bas\b/g, ':')} = __deps[${index}];`
  })
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)/gm)].map(match => match[1])
  source = source.replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let)\s)/gm, '').replace(/^export\s*\{\s*\};?\s*$/gm, '')
  const result = new Function('__deps', `${source}\nreturn {${names.join(',')}}`)(deps)
  loaded.set(path, result)
  return result
}
const { InputTriggerService } = load(`${root}/ui-input-trigger/src/client/service.ts`)
const { CommandUiRuntime } = load(`${root}/ui-commands/src/client/service.ts`)
const flush = async () => { for (let i = 0; i < 18; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function bench() {
  const events = [], cleanups = new Set(), bindings = new Map(), executeCalls = []
  const services = new Map()
  const ctx = {
    get: name => services.get(name),
    effect(fn) {
      const cleanup = fn()
      let active = true
      const off = () => { if (!active) return; active = false; cleanups.delete(off); cleanup?.() }
      cleanups.add(off)
      return off
    },
    on: () => () => {}, logger: { warn() {} },
    events: { dispatch: () => [] },
  }
  for (const id of ['s1', 's2']) {
    const actx = { ...ctx, bail: (_subject, event, request) => { events.push({ id, event, request }); return true } }
    const session = { sessionId: id, getSnapshot: () => ({ openState: 'open' }) }
    bindings.set(id, { sessionId: id, session, ctx: actx })
  }
  const sessions = {
    binding: id => bindings.get(id), scope: id => bindings.get(id)?.ctx,
    sessionOf: actx => [...bindings.values()].find(b => b.ctx === actx)?.session,
    using: async (id, _options, operation) => operation({ binding: bindings.get(id) }),
    subagentAddress: () => undefined,
  }
  services.set('sessions', sessions)
  services.set('locale', { bind: () => key => key })
  const remote = { $on() {}, commands: {
    list: async id => ({ ok: true, value: [{ name: 'bare', description: id }, { name: 'args', description: 'input', input: { hint: 'arguments' } }] }),
    execute: async (id, line, attachments) => {
      executeCalls.push({ id, line, attachments })
      return result.execute(id, line)
    },
  } }
  ctx.remote = remote
  const triggers = new InputTriggerService(ctx)
  services.set('inputTriggers', triggers)
  const commands = new CommandUiRuntime(ctx)
  const result = { ctx, sessions, bindings, triggers, commands, events, executeCalls,
    execute: async () => ({ ok: true, value: { commandId: 'one', result: { kind: 'success' } } }),
    get cleanupCount() { return cleanups.size },
    cleanup: () => { for (const fn of [...cleanups].reverse()) fn() },
  }
  return result
}
function target(draft = '/') {
  const abort = new AbortController(), notices = [], edits = [], consumptions = []
  let pending = 0, revision = 1, focus = 0
  const value = { abort, notices, edits, consumptions, get draft() { return draft }, get pending() { return pending }, get focusCount() { return focus },
    setDraft(text) { draft = text; revision++ },
    signal: abort.signal, isAvailable: () => !abort.signal.aborted && pending === 0,
    async withOperation(operation) { if (abort.signal.aborted) throw new Error('closing'); pending++; try { return await operation() } finally { pending-- } },
    beginCommand(claim, span) { edits.push({ kind: 'claim', claim, span }); return span.draftRev === revision },
    insertText(text, span, continuation, fromLauncher) { if (span.draftRev !== revision) return false; edits.push({ kind: 'text', text, span, continuation, fromLauncher }); draft = draft.slice(0, span.start) + text + draft.slice(span.end); revision++; return true },
    insertReference(reference, span) { edits.push({ kind: 'reference', reference, span }); return true },
    consumeToken(guard) { consumptions.push(guard); const valid = guard.kind === 'span' ? guard.span.draftRev === revision : draft.trim() === guard.token; if (!valid) return false; draft = ''; revision++; return true },
    focus() { focus++ }, notify(level, text) { notices.push({ level, text }) },
  }
  return value
}
function surface(b, id = 's1', draft = '/') {
  const token = Object.freeze({ id: 'same-debug-id' }), sink = target(draft)
  const binding = b.bindings.get(id)
  const command = b.commands.attachSurface(binding.ctx, token, sink)
  const trigger = b.triggers.createSurface(binding.ctx, token, sink)
  return { token, sink, command, trigger, session: { sessionId: id, surface: token } }
}
function find(controller, name, source = 'command') {
  const group = controller.menu.getSnapshot().groups.find(row => row.source === source)
  return group?.items.findIndex(row => row.name === name) ?? -1
}
async function menu(s, draft = '/') { s.trigger.track(draft, draft.length, { tier: 'plain' }, 1); await flush() }

test('same Session surfaces use independent native controllers, tokens and mutation targets', async () => {
  const b = bench(), a = surface(b), c = surface(b)
  b.triggers.registerSource({ trigger: '/', name: 'skill', candidates: async () => [{ name: 'some-skill' }], onPick: ({ candidate }) => ({ text: `/${candidate.name} ` }) })
  await menu(a); await menu(c)
  assert.notEqual(a.trigger, c.trigger)
  assert.equal(typeof a.trigger.View, 'function')
  assert.equal(typeof a.command.View, 'function')
  a.trigger.pick('skill', find(a.trigger, 'some-skill', 'skill'))
  assert.equal(a.sink.draft, '/some-skill ')
  assert.equal(c.sink.draft, '/')
  assert.equal(b.events.length, 0)
  const native = b.triggers.sessionOf(b.bindings.get('s1').ctx)
  native.track('/', 1, { tier: 'plain' }, 1); await flush()
  native.pick('skill', find(native, 'some-skill', 'skill'))
  assert.equal(b.events.at(-1).event, 'slash/input-insert-text')
  b.cleanup()
})

test('bare command success consumes only after flight; failure retains draft without prompt', async () => {
  const b = bench(), a = surface(b), flight = deferred()
  b.execute = () => flight.promise
  await menu(a)
  a.trigger.pick('command', find(a.trigger, 'bare'))
  assert.equal(a.sink.pending, 1)
  assert.equal(a.sink.draft, '/')
  // New gestures cannot start a duplicate flight.
  a.trigger.pick('command', find(a.trigger, 'bare'))
  assert.equal(b.executeCalls.length, 1)
  flight.resolve({ ok: true, value: { result: { kind: 'success' } } }); await flush()
  assert.equal(a.sink.draft, '')
  assert.equal(a.sink.pending, 0)
  const failed = surface(b, 's2')
  b.execute = async () => ({ ok: true, value: { result: { kind: 'error', text: 'nope' } } })
  await menu(failed); failed.trigger.pick('command', find(failed.trigger, 'bare')); await flush()
  assert.equal(failed.sink.draft, '/')
  assert.equal(failed.sink.notices[0].text, 'nope')
  assert.equal(b.executeCalls.at(-1).id, 's2')
  assert.equal(b.events.length, 0)
  b.cleanup()
})

test('bare completion uses captured CAS span and cannot erase later draft', async () => {
  const b = bench(), a = surface(b), flight = deferred()
  b.execute = () => flight.promise
  await menu(a); a.trigger.pick('command', find(a.trigger, 'bare'))
  a.sink.setDraft('newer draft')
  flight.resolve({ ok: true, value: { result: { kind: 'success' } } }); await flush()
  assert.equal(a.sink.draft, 'newer draft')
  b.cleanup()
})

test('claimed arguments execute through the native Remote under nested operation lifetime', async () => {
  const b = bench(), a = surface(b, 's2', '/args hello')
  const claim = await a.sink.withOperation(async () => {
    const outcome = await a.trigger.adjudicate('/args hello', new AbortController().signal, { attachments: 0 })
    assert.equal(outcome.claim.name, 'args')
    return outcome.claim
  })
  await a.sink.withOperation(() => claim.submit('hello', b.bindings.get('s2').ctx, []))
  assert.deepEqual(b.executeCalls[0], { id: 's2', line: '/args hello', attachments: [] })
  assert.equal(a.sink.pending, 0)
  b.cleanup()
})

test('surface popup reuses native business spec and isolated select lifetime', async () => {
  const b = bench(), a = surface(b), c = surface(b), selected = deferred()
  const seen = []
  b.commands.register({ name: 'model', available: () => true, ui: { kind: 'popupSelect', options: async () => [{ id: 'a', label: 'A' }], onSelect: (option, context) => { seen.push(context); return selected.promise } } })
  await menu(a); await menu(c)
  a.trigger.pick('command', find(a.trigger, 'model')); await flush()
  assert.equal(a.command.popup.state.getSnapshot().open, true)
  assert.equal(c.command.popup.state.getSnapshot().open, false)
  const pending = a.command.popup.select(0)
  assert.equal(a.sink.pending, 1)
  assert.equal(seen[0].surface, a.token)
  a.sink.abort.abort()
  assert.equal(a.command.popup.state.getSnapshot().open, false)
  assert.equal(a.sink.pending, 1)
  selected.resolve(); await pending
  assert.equal(a.sink.pending, 0)
  assert.equal(a.sink.consumptions.length, 0)
  assert.equal(a.sink.focusCount, 0)
  assert.equal(b.events.length, 0)
  b.cleanup()
})

test('unknown, disposed, reused and mismatched binding tokens never fall back native', async () => {
  const b = bench(), a = surface(b)
  const off = b.triggers.registerSource({ trigger: '/', name: 'observer', candidates: async () => [], onPick: () => undefined, warm: () => {} })
  // A controller with a forged token asks the shared command source; it must reject.
  const forged = b.triggers.createSurface(b.bindings.get('s1').ctx, { id: a.token.id }, target())
  await assert.rejects(forged.adjudicate('/bare', new AbortController().signal, { attachments: 0 }), /unknown or closed/)
  assert.equal(b.events.length, 0)
  a.command.dispose()
  await assert.rejects(a.trigger.adjudicate('/bare', new AbortController().signal, { attachments: 0 }), /unknown or closed/)
  assert.throws(() => b.commands.attachSurface(b.bindings.get('s1').ctx, a.token, a.sink), /already used/)
  const c = surface(b)
  b.bindings.set('s1', { ...b.bindings.get('s1') })
  await assert.rejects(c.trigger.adjudicate('/bare', new AbortController().signal, { attachments: 0 }), /unknown or closed/)
  off(); b.cleanup()
})

test('aborted surface invalidates candidates and does not apply late skill results', async () => {
  const b = bench(), a = surface(b), flight = deferred()
  let candidateSignal
  b.triggers.registerSource({ trigger: '/', name: 'slow', candidates: (_session, req) => { candidateSignal = req.signal; return flight.promise }, onPick: () => ({ text: '/slow ' }) })
  await menu(a)
  a.sink.abort.abort()
  assert.equal(candidateSignal.aborted, true)
  flight.resolve([{ name: 'slow' }]); await flush()
  assert.equal(a.trigger.menu.getSnapshot().open, false)
  assert.equal(a.sink.edits.length, 0)
  await assert.rejects(a.trigger.adjudicate('/bare', new AbortController().signal, { attachments: 0 }), /closed/)
  b.cleanup()
})

test('surface disposal unregisters owner and binding effects without recursive cleanup', () => {
  const b = bench(), baseline = b.cleanupCount
  const a = surface(b)
  assert.equal(b.cleanupCount, baseline + 4)
  a.trigger.dispose(); a.command.dispose()
  assert.equal(b.cleanupCount, baseline)
  a.trigger.dispose(); a.command.dispose(); a.sink.abort.abort()
  assert.equal(b.cleanupCount, baseline)
  b.cleanup()
})

test('failed trigger construction releases earlier source subscriptions', () => {
  const b = bench()
  let subscriptions = 0
  b.triggers.registerSource({ trigger: '/', name: 'watched', candidates: async () => [], onPick() {}, lexicon: () => [], subscribeLexicon: () => { subscriptions++; return () => { subscriptions-- } } })
  b.triggers.registerSource({ trigger: '/', name: 'bad', candidates: async () => [], onPick() {}, warm() { throw new Error('provider failed') } })
  const baseline = b.cleanupCount
  assert.throws(() => b.triggers.createSurface(b.bindings.get('s1').ctx, { id: 'failed' }, target()), /provider failed/)
  assert.equal(subscriptions, 0)
  assert.equal(b.cleanupCount, baseline)
  b.cleanup()
})

test('post-success target consumption errors are contained on the originating surface', async () => {
  const b = bench(), a = surface(b)
  a.sink.consumeToken = () => { throw new Error('CAS target threw') }
  await menu(a); a.trigger.pick('command', find(a.trigger, 'bare')); await flush()
  assert.equal(a.sink.notices[0].text, 'CAS target threw')
  assert.equal(b.events.length, 0)
  b.cleanup()
})

test('reference codec and late roster updates reuse native sources and stop at closure', async () => {
  const b = bench(), a = surface(b)
  const off = b.triggers.registerSource({ trigger: '@', name: 'reference', candidates: async () => [{ name: 'doc' }], onPick: () => ({ insert: { ref: 'doc', source: 'reference', label: 'doc' } }), codec: { clipboardText: ref => `@${ref}`, serialize: async ref => `native:${ref}` } })
  assert.equal(await a.trigger.serializeReference('reference', 'doc', new AbortController().signal), 'native:doc')
  off()
  await assert.rejects(a.trigger.serializeReference('reference', 'doc', new AbortController().signal), /no serializer/)
  a.sink.abort.abort()
  await assert.rejects(a.trigger.serializeReference('reference', 'doc', new AbortController().signal), /aborted/)
  b.cleanup()
})

test('popup callback failure keeps token and search, global dismiss closes all surface popups', async () => {
  const b = bench(), a = surface(b), c = surface(b)
  b.commands.register({ name: 'model', available: () => true, ui: { kind: 'popupSelect', options: async () => [{ id: 'a', label: 'Alpha' }], onSelect: async () => { throw new Error('selection refused') } } })
  await menu(a); await menu(c)
  a.trigger.pick('command', find(a.trigger, 'model')); c.trigger.pick('command', find(c.trigger, 'model')); await flush()
  a.command.popup.setSearch('Al')
  const oldError = console.error
  try { console.error = () => {}; await a.command.popup.select(0) } finally { console.error = oldError }
  assert.equal(a.sink.draft, '/')
  assert.equal(a.command.popup.state.getSnapshot().search, 'Al')
  assert.equal(a.command.popup.state.getSnapshot().error, 'selection refused')
  assert.equal(a.sink.pending, 0)
  b.commands.dismiss('model')
  assert.equal(a.command.popup.state.getSnapshot().open, false)
  assert.equal(c.command.popup.state.getSnapshot().open, false)
  b.cleanup()
})

test('a pending interaction appearing after popup open refuses selection and confirmation', async () => {
  const b = bench(), a = surface(b)
  let selections = 0, available = true
  a.sink.isAvailable = () => available && a.sink.pending === 0
  const confirmation = { title: 'Confirm', description: 'Risk', acknowledgeLabel: 'Yes', cancelLabel: 'No', confirmLabel: 'Proceed' }
  b.commands.register({ name: 'model', available: () => true, ui: { kind: 'popupSelect', options: async () => [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta', confirmation }], onSelect: async () => { selections++ } } })
  await menu(a); a.trigger.pick('command', find(a.trigger, 'model')); await flush()
  available = false
  const oldError = console.error
  try {
    console.error = () => {}
    await a.command.popup.select(0)
    assert.equal(selections, 0)
    assert.equal(a.command.popup.state.getSnapshot().error, 'command input surface is unavailable')
    available = true
    await a.command.popup.select(1)
    a.command.popup.acknowledge(true)
    available = false
    await a.command.popup.confirm()
    assert.equal(selections, 0)
    assert.equal(a.sink.draft, '/')
    assert.equal(a.sink.pending, 0)
  } finally { console.error = oldError }
  b.cleanup()
})

const launcherHit = (start = 0, end = start, draftRev = 1) => ({ trigger: '/', query: '', quoted: false, position: start === 0 ? 'leading' : 'inline', span: { start, end, draftRev } })
function registerSkills(b, requests = []) {
  return b.triggers.registerSource({ trigger: '/', name: 'skill', candidates: async (_session, request) => {
    requests.push(request)
    return ['skill-alpha', 'skill-beta'].filter(name => name.includes(request.query)).map(name => ({ name }))
  }, onPick: ({ candidate }) => ({ text: `/${candidate.name} ` }) })
}

test('combined launcher captures selection and routes all slash groups without draft mutation', async () => {
  const b = bench(), a = surface(b, 's1', '左选右'), requests = []
  registerSkills(b, requests)
  const hit = launcherHit(1, 2), expectedSpan = { ...hit.span }
  a.trigger.toggleAll(hit); await flush()
  const marker = a.trigger.launcher.getSnapshot()
  assert.equal(typeof marker, 'string')
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['command', 'skill'])
  assert.equal(a.sink.draft, '左选右'); assert.equal(a.sink.edits.length, 0)
  hit.span.start = 0 // Caller mutation cannot rewrite the captured selection.
  a.trigger.filterLauncher('alpha'); await flush()
  a.trigger.track('左选右', 3, { tier: 'plain' }, 1)
  a.trigger.track('左选右', 0, { tier: 'plain' }, 1)
  assert.equal(a.trigger.launcher.getSnapshot(), marker)
  assert.equal(a.trigger.menu.getSnapshot().hit.query, 'alpha')
  assert.deepEqual(a.trigger.menu.getSnapshot().hit.span, expectedSpan)
  assert.equal(requests.at(-1).query, 'alpha'); assert.equal(requests.at(-1).position, 'inline')
  a.trigger.pick('skill', find(a.trigger, 'skill-alpha', 'skill'))
  assert.equal(a.sink.draft, '左/skill-alpha 右')
  assert.deepEqual(a.sink.edits.at(-1).span, expectedSpan)
  assert.equal(a.sink.edits.at(-1).fromLauncher, true)
  assert.equal(a.trigger.launcher.getSnapshot(), null)
  assert.equal(b.events.length, 0)
  b.cleanup()
})

test('combined query changes feed commands but never become command arguments or space claims', async () => {
  const b = bench(), a = surface(b, 's1', 'original text')
  registerSkills(b)
  a.trigger.toggleAll(launcherHit(0, 13)); await flush()
  a.trigger.filterLauncher('ar'); await flush()
  const commands = a.trigger.menu.getSnapshot().groups.find(g => g.source === 'command')
  assert.deepEqual(commands.items.map(x => x.name), ['bare', 'args'])
  assert.equal(a.trigger.onSpace(), false)
  assert.equal(a.sink.edits.length, 0)
  a.trigger.hover('command', find(a.trigger, 'args'))
  assert.equal(a.trigger.arbitrate('enter', false), 'pick-highlighted')
  assert.equal(a.sink.edits.at(-1).claim.token, '/args ')
  assert.deepEqual(a.sink.edits.at(-1).span, { start: 0, end: 13, draftRev: 1 })
  assert.equal(a.sink.draft, 'original text')
  assert.equal(b.executeCalls.length, 0)
  b.cleanup()
})

test('combined keyboard moves across groups, picks a skill and Escape/toggle close without insertion', async () => {
  const b = bench(), a = surface(b, 's1', '')
  registerSkills(b)
  a.trigger.toggleAll(launcherHit()); await flush()
  a.trigger.hover('command', find(a.trigger, 'args'))
  assert.equal(a.trigger.arbitrate('down', false), 'consumed')
  assert.equal(a.trigger.menu.getSnapshot().highlight.source, 'skill')
  assert.equal(a.trigger.arbitrate('enter', true), 'pass')
  assert.equal(a.sink.draft, '')
  assert.equal(a.trigger.arbitrate('tab', false), 'pick-highlighted')
  assert.equal(a.sink.draft, '/skill-alpha ')
  a.trigger.toggleAll(launcherHit(13, 13, 2)); await flush()
  assert.equal(a.trigger.arbitrate('escape', false), 'consumed')
  assert.equal(a.trigger.launcher.getSnapshot(), null)
  assert.equal(a.sink.draft, '/skill-alpha ')
  a.trigger.toggleAll(launcherHit(13, 13, 2)); await flush()
  a.trigger.toggleAll(launcherHit(0, 0, 2))
  assert.equal(a.trigger.menu.getSnapshot().open, false)
  assert.equal(a.trigger.launcher.getSnapshot(), null)
  assert.equal(a.sink.draft, '/skill-alpha ')
  b.cleanup()
})

test('empty combined search stays editable, superseded query results cannot reappear', async () => {
  const b = bench(), a = surface(b, 's1', ''), calls = []
  b.triggers.registerSource({ trigger: '/', name: 'skill', candidates: (_session, request) => {
    const result = deferred(); calls.push({ request, result }); return result.promise
  }, onPick: ({ candidate }) => ({ text: `/${candidate.name} ` }) })
  a.trigger.toggleAll(launcherHit()); await flush()
  a.trigger.filterLauncher('missing'); await flush()
  assert.equal(calls[0].request.signal.aborted, true)
  calls[1].result.resolve([]); await flush()
  assert.equal(a.trigger.menu.getSnapshot().open, true)
  assert.notEqual(a.trigger.launcher.getSnapshot(), null)
  assert.equal(a.trigger.menu.getSnapshot().highlight, null)
  assert.equal(a.trigger.arbitrate('enter', false), 'pass') // Parent search never submits on pass.
  a.trigger.filterLauncher('fresh'); await flush()
  calls[0].result.resolve([{ name: 'obsolete' }])
  calls[2].result.resolve([{ name: 'fresh' }]); await flush()
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.find(g => g.source === 'skill').items, [{ name: 'fresh' }])
  assert.equal(a.sink.draft, '')
  b.cleanup()
})

test('combined refresh, lexicon invalidation and source changes retain all groups, query and CAS', async () => {
  const b = bench(), a = surface(b, 's1', 'text'), queries = []
  let invalidate
  const off = b.triggers.registerSource({ trigger: '/', name: 'skill', candidates: async (_session, req) => { queries.push(req.query); return [{ name: 'keep' }] }, onPick: () => undefined,
    lexicon: () => [], subscribeLexicon: (_session, notify) => { invalidate = notify; return () => {} } })
  a.trigger.toggleAll(launcherHit(2)); a.trigger.filterLauncher('keep'); await flush()
  const expected = a.trigger.menu.getSnapshot().hit
  a.trigger.refreshOpenMenu(); await flush(); invalidate(); await flush()
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['command', 'skill'])
  assert.equal(queries.at(-1), 'keep'); assert.deepEqual(a.trigger.menu.getSnapshot().hit, expected)
  const offExtra = b.triggers.registerSource({ trigger: '/', name: 'extra', candidates: async () => [{ name: 'extra' }], onPick: () => undefined })
  await flush()
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['command', 'skill', 'extra'])
  off(); await flush()
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['command', 'extra'])
  assert.deepEqual(a.trigger.menu.getSnapshot().hit, expected)
  offExtra(); await flush()
  assert.equal(a.trigger.menu.getSnapshot().open, true)
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['command'])
  b.cleanup()
})

test('combined source failure stays distinguishable while ready groups remain selectable', async () => {
  const b = bench()
  b.ctx.remote.commands.list = async () => ({ ok: false, error: { code: 'offline', message: 'catalog unavailable' } })
  const a = surface(b, 's1', '')
  registerSkills(b)
  const originalError = console.error
  try {
    console.error = () => {}
    a.trigger.toggleAll(launcherHit()); await flush()
    const state = a.trigger.menu.getSnapshot()
    assert.equal(state.open, true)
    assert.equal(state.groups.find(g => g.source === 'command').failed, true)
    assert.deepEqual(state.groups.find(g => g.source === 'command').items, [])
    assert.equal(state.groups.find(g => g.source === 'skill').failed, false)
    assert.equal(state.highlight.source, 'skill')
    assert.equal(a.trigger.arbitrate('enter', false), 'pick-highlighted')
    assert.equal(a.sink.draft, '/skill-alpha ')
    const native = b.triggers.sessionOf(b.bindings.get('s1').ctx)
    native.track('/', 1, { tier: 'plain' }, 1); await flush()
    assert.deepEqual(native.menu.getSnapshot().groups.map(g => g.source), ['skill'])
    assert.equal(native.menu.getSnapshot().groups[0].failed, undefined)
  } finally { console.error = originalError; b.cleanup() }
})

test('combined all-failed catalogs are not empty results, and a new query clears failure before retry', async () => {
  const b = bench()
  b.ctx.remote.commands.list = async () => ({ ok: false, error: { code: 'offline', message: 'offline' } })
  const a = surface(b, 's1', ''), retry = deferred()
  let failing = true
  b.triggers.registerSource({ trigger: '/', name: 'skill', candidates: async () => {
    if (failing) throw new Error('skill catalog offline')
    return retry.promise
  }, onPick: ({ candidate }) => ({ text: `/${candidate.name} ` }) })
  const originalError = console.error
  try {
    console.error = () => {}
    a.trigger.toggleAll(launcherHit()); await flush()
    const failed = a.trigger.menu.getSnapshot()
    assert.equal(failed.open, true)
    assert.equal(failed.groups.length, 2)
    assert.ok(failed.groups.every(g => g.failed === true && g.items.length === 0))
    assert.equal(failed.groups.every(g => g.status === 'ready' && g.items.length === 0 && !g.failed), false)
    assert.equal(failed.highlight, null)
    failing = false
    a.trigger.filterLauncher('retry')
    assert.ok(a.trigger.menu.getSnapshot().groups.every(g => g.status === 'pending' && g.failed === false))
    retry.resolve([{ name: 'retry' }]); await flush()
    const recovered = a.trigger.menu.getSnapshot().groups.find(g => g.source === 'skill')
    assert.equal(recovered.failed, false); assert.equal(recovered.status, 'ready')
    assert.deepEqual(recovered.items, [{ name: 'retry' }])
    assert.equal(a.sink.draft, '')
  } finally { console.error = originalError; b.cleanup() }
})

test('combined busy/disposed guards reject new launcher gestures and picks', async () => {
  const b = bench(), a = surface(b, 's1', ''), requests = []
  registerSkills(b, requests)
  let available = false
  a.sink.isAvailable = () => available
  a.trigger.toggleAll(launcherHit()); await flush()
  assert.equal(a.trigger.menu.getSnapshot().open, false); assert.equal(requests.length, 0)
  available = true; a.trigger.toggleAll(launcherHit()); await flush()
  available = false; a.trigger.filterLauncher('alpha')
  assert.equal(a.trigger.menu.getSnapshot().hit.query, '')
  a.trigger.pick('skill', find(a.trigger, 'skill-alpha', 'skill'))
  assert.equal(a.trigger.arbitrate('enter', false), 'consumed')
  assert.equal(a.sink.edits.length, 0); assert.equal(b.executeCalls.length, 0)
  assert.equal(a.trigger.arbitrate('escape', false), 'consumed')
  available = true; a.trigger.dispose(); a.trigger.toggleAll(launcherHit()); a.trigger.filterLauncher('alpha')
  assert.equal(a.trigger.menu.getSnapshot().open, false)
  assert.equal(a.trigger.arbitrate('enter', false), 'pass')
  b.cleanup()
})

test('combined stale CAS is never rebased by search and a tracked draft edit revokes callbacks', async () => {
  const b = bench(), a = surface(b, 's1', 'old')
  registerSkills(b)
  a.trigger.toggleAll(launcherHit(0, 3)); await flush()
  a.sink.setDraft('new')
  a.trigger.filterLauncher('alpha'); await flush()
  a.trigger.pick('skill', find(a.trigger, 'skill-alpha', 'skill'))
  assert.equal(a.sink.draft, 'new'); assert.equal(a.sink.edits.length, 0)
  a.trigger.toggleAll(launcherHit(0, 3, 2)); await flush()
  a.sink.setDraft('newer'); a.trigger.track('newer', 5, { tier: 'plain' }, 3)
  assert.equal(a.trigger.menu.getSnapshot().open, false)
  a.trigger.pick('command', 0)
  assert.equal(b.executeCalls.length, 0); assert.equal(a.sink.draft, 'newer')
  b.cleanup()
})

test('native single-source launcher and typed slash behavior remain unchanged', async () => {
  const b = bench(), a = surface(b, 's1', ''), requests = []
  registerSkills(b, requests)
  a.trigger.toggleSource('skill', launcherHit()); await flush()
  assert.equal(a.trigger.launcher.getSnapshot(), 'skill')
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['skill'])
  a.trigger.filterLauncher('alpha'); assert.equal(requests.at(-1).query, '')
  a.trigger.track('', 0, { tier: 'plain' }, 1)
  assert.equal(a.trigger.menu.getSnapshot().open, true); assert.equal(a.trigger.launcher.getSnapshot(), null)
  a.trigger.track('', 0, { tier: 'plain' }, 1)
  assert.equal(a.trigger.menu.getSnapshot().open, false)
  a.trigger.track('/skill', 6, { tier: 'plain' }, 1); await flush()
  assert.deepEqual(a.trigger.menu.getSnapshot().groups.map(g => g.source), ['command', 'skill'])
  a.trigger.pick('skill', find(a.trigger, 'skill-alpha', 'skill'))
  assert.equal(a.sink.edits.at(-1).fromLauncher, false)
  const native = b.triggers.sessionOf(b.bindings.get('s1').ctx)
  native.toggleSource('skill', launcherHit()); await flush()
  native.pick('skill', find(native, 'skill-alpha', 'skill'))
  assert.equal(b.events.at(-1).event, 'slash/input-insert-text')
  assert.equal('fromLauncher' in b.events.at(-1).request, false)
  native.track('/no-matches', 11, { tier: 'plain' }, 1); await flush()
  assert.equal(native.menu.getSnapshot().open, false)
  b.cleanup()
})

test('MenuView supports instance DOM ids while native ids remain backward compatible', () => {
  const source = readFileSync(`${root}/ui-input-trigger/src/client/MenuView.tsx`, 'utf8')
  assert.match(source, /readonly idPrefix\?: string/)
  assert.match(source, /id=\{idPrefix === undefined \? undefined : `\$\{idPrefix\}-listbox`\}/)
  assert.match(source, /prefix = 'dsh-slash-option'/)
  assert.match(source, /id=\{optionId\(group.source, index, idPrefix\)\}/)
  assert.match(source, /aria-activedescendant=\{highlight !== null \? optionId\(highlight.source, highlight.index, idPrefix\)/)
})
