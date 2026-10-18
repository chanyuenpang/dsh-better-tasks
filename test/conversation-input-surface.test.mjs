import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import * as zod from 'zod'

// Pure contract tests: actual surface factory, native shell and submit machine.
// Only the editor document, stores, providers and view module are test doubles;
// no browser, profile, real prompt, build or filesystem mutation is involved.
const root = resolve('.srcbuild/packages/client/ui-conversation/src/client')
const store = initial => {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, set(next) { value = next; for (const fn of [...listeners]) fn() }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
}
const editors = []
class DraftEditorRuntime {
  constructor(deps) {
    this.deps = deps; this.text = ''; this.occurrences = []; this.disposed = false; this.focusCount = 0
    this.projected = { clipboardText: '', detectText: '', occurrences: [], caret: null }
    this.editor = { focus: () => this.focusCount++, getRootElement: () => null }
    editors.push(this)
  }
  get projection() { return this.projected }
  register() { return () => { this.disposed = true } }
  refreshProjection() { const previous = this.projected; this.projected = { clipboardText: this.text, detectText: this.text, occurrences: this.occurrences, caret: this.text.length }; return previous }
  setDraft(text) { this.text = text; this.occurrences = []; this.deps.onUpdate() }
  replaceText(span, text) { this.setDraft(this.text.slice(0, span.start) + text + this.text.slice(span.end)); return true }
  insertReference(span, value) { this.text = this.text.slice(0, span.start) + value.clipboardText + this.text.slice(span.end); this.occurrences = [{ ...value, occurrenceId: 'one', offset: span.start, length: value.clipboardText.length }]; this.deps.onUpdate(); return true }
  clearCommittedDraft(keep) { const offset = keep(this.text); this.setDraft(offset === null ? '' : this.text.slice(offset)) }
  restoreDraft(text, occurrences) { this.text = text; this.occurrences = occurrences; this.deps.onUpdate() }
  clearHistory() {}
  refreshClaimDecoration() {}
  caretSpan() { return { start: this.text.length, end: this.text.length } }
}
const loaded = new Map()
function load(path) {
  path = resolve(path)
  if (loaded.has(path)) return loaded.get(path)
  if (path.replaceAll('\\', '/').endsWith('editor/runtime.ts')) return { DraftEditorRuntime }
  if (path.endsWith('InputSurfaceView.tsx')) return { InputSurfaceView: () => null }
  const externals = {
    react: { createElement: (type, props) => ({ type, props }) },
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: store },
    zod,
  }
  let source = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform', sourceUrl: path })
  const deps = []
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, imports, name) => {
    const dependency = name.startsWith('.') ? load(resolve(dirname(path), name)) : externals[name]
    assert.ok(dependency, `missing dependency ${name}`)
    const index = deps.push(dependency) - 1
    return `const ${imports.trim().replace(/\bas\b/g, ':')} = __deps[${index}];`
  })
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let)\s+(\w+)/gm)].map(match => match[1])
  source = source.replace(/^export\s+(?=(?:async\s+)?(?:class|function|const|let)\s)/gm, '').replace(/^export\s*\{\s*\};?\s*$/gm, '')
  const result = new Function('__deps', `${source}\nreturn {${names.join(',')}}`)(deps)
  loaded.set(path, result)
  return result
}
const { createInputSurface } = load(`${root}/input/surface.ts`)
const { createSurfaceLifetime } = load(`${root}/input/surface-lifetime.ts`)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
function bench({ openState = 'open', ready } = {}) {
  let refs = 0, releases = 0, retains = 0
  const snapshot = store({ sessionId: 's1', openState, running: false, removed: false, subagent: null, openError: openState === 'error' ? new Error('cannot open') : null })
  const status = store(new Map([['s1', { running: false }]])), block = store(undefined)
  const bindings = new Map(), prompts = [], scopes = [], cleanups = [], triggerSurfaces = [], commandSurfaces = []
  const effect = fn => { const off = fn(); let active = true; const dispose = () => { if (active) { active = false; off?.() } }; cleanups.push(dispose); return dispose }
  const actx = { effect, on() { throw new Error('A surface must not install Session-wide input listeners') } }
  const session = { sessionId: 's1', getSnapshot: snapshot.getSnapshot, subscribe: snapshot.subscribe,
    projections: { faceOf: () => store(undefined) }, beginSubmission: () => ({ requestId: 'echo', abandon() {} }),
    prompt: (...args) => { prompts.push(args); return value.prompt(...args) },
  }
  const binding = { sessionId: 's1', session, ctx: actx }
  const sessions = {
    binding: id => bindings.get(id),
    retain(id, options) {
      retains++; refs++; bindings.set(id, binding); scopes.push(options)
      let released = false
      const opening = ready ?? Promise.resolve(binding)
      const cancelled = new Promise((_, reject) => { if (options.signal?.aborted) reject(options.signal.reason); else options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true }) })
      return { binding, ready: Promise.race([opening, cancelled]), release() { if (released) return; released = true; releases++; if (--refs === 0) bindings.delete(id) } }
    },
  }
  const services = new Map([
    ['sessions', sessions], ['locale', { bind: () => key => key }],
    ['uiSession', { sessionStatus: status }], ['conversation', { blocks: { storeFor: () => block },
      sendSession: async (target, text, attachments, mode, signal) => {
        const echo = target.beginSubmission({ text, mode, attachments })
        const result = await target.prompt([{ type: 'text', text }], mode, signal, echo.requestId)
        return result.ok ? { kind: 'success' } : { kind: 'error', text: result.error.message }
      },
    }],
    ['inputTriggers', { createSurface(ctx, token, target) {
      const instance = { token, target, disposed: 0, View: () => null, menu: store({ open: false }), headers: store(new Map()),
        lexicon: store(new Map()), launcher: store(null), launches: [], dismissals: 0, track() {}, dismiss() { this.dismissals++ }, dispose() { this.disposed++ },
        toggleSource(source, hit) { this.launches.push({ source, hit, focusCount: editors.at(-1).focusCount }) },
        toggleAll(hit) { this.launches.push({ source: 'all', hit, focusCount: editors.at(-1).focusCount }) },
        filterLauncher(query) { this.lastQuery = query },
        adjudicate: (...args) => value.adjudicate(...args), serializeReference: (...args) => value.serialize(...args), openReference: () => false,
      }
      triggerSurfaces.push(instance); return instance
    } }],
    ['commandUi', { attachSurface(ctx, token, target) {
      const instance = { token, target, disposed: 0, popup: { dismissals: 0, dismiss() { this.dismissals++ } }, View: () => null, dispose() { this.disposed++ } }
      commandSurfaces.push(instance); return instance
    } }],
  ])
  const value = { ctx: { get: name => services.get(name), effect }, binding, session, sessions, snapshot, status, block, prompts, triggerSurfaces, commandSurfaces, scopes,
    get refs() { return refs }, get releases() { return releases }, get retains() { return retains },
    prompt: async () => ({ ok: true, value: { accepted: true } }), adjudicate: async () => undefined, serialize: async () => 'serialized',
    cleanup: () => { for (const off of [...cleanups].reverse()) off() },
  }
  return value
}

test('factory retains unopened Session and creates distinct draft/editor surfaces without focus or native listeners', async () => {
  const b = bench(), start = editors.length
  const a = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: 'alpha' })
  const c = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: 'beta' })
  assert.equal(b.refs, 2)
  assert.equal(a.state.getSnapshot().draft, 'alpha'); assert.equal(c.state.getSnapshot().draft, 'beta')
  a.input.setDraft('changed')
  assert.equal(c.state.getSnapshot().draft, 'beta')
  assert.notEqual(b.triggerSurfaces[0].token, b.triggerSurfaces[1].token)
  assert.equal(typeof a.View, 'function'); assert.equal(editors[start].focusCount, 0)
  a.dispose(); a.dispose(); await a.closed
  assert.equal(b.refs, 1); assert.equal(editors[start].disposed, true); assert.equal(editors[start + 1].disposed, false)
  c.dispose(); await c.closed; assert.equal(b.releases, 2)
})

test('ready resolving with openState error releases exactly once without sending', async () => {
  const b = bench({ openState: 'error' })
  await assert.rejects(createInputSurface(b.ctx, { sessionId: 's1' }), /cannot open/)
  assert.equal(b.releases, 1); assert.equal(b.prompts.length, 0)
})

test('abort during acquisition never materializes the shell and releases once', async () => {
  const ready = deferred(), b = bench({ ready: ready.promise }), abort = new AbortController(), start = editors.length
  const creating = createInputSurface(b.ctx, { sessionId: 's1', signal: abort.signal })
  abort.abort(new Error('cancel opening'))
  await assert.rejects(creating, /cancel opening/)
  assert.equal(b.releases, 1); assert.equal(editors.length, start)
})

test('submit void does not release Session; closing waits admitted prompt without abort or duplicate', async () => {
  const flight = deferred(), b = bench(), start = editors.length
  b.prompt = () => flight.promise
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: 'keep going' })
  assert.equal(surface.input.submit('steer'), undefined)
  await flush()
  assert.equal(b.prompts.length, 1); assert.equal(b.prompts[0][0][0].text, 'keep going'); assert.equal(b.prompts[0][1], 'steer')
  surface.dispose()
  assert.equal(b.releases, 0); assert.equal(editors[start].disposed, false)
  assert.equal(b.triggerSurfaces[0].target.signal.aborted, true)
  assert.equal(b.prompts[0][2].aborted, false)
  surface.input.submit(); assert.equal(b.prompts.length, 1)
  flight.resolve({ ok: true, value: { accepted: true } })
  await surface.closed
  assert.equal(b.releases, 1); assert.equal(editors[start].disposed, true)
})

test('pending interaction appearing during adjudication prevents ordinary sink and retains draft', async () => {
  const adjudication = deferred(), b = bench(); b.adjudicate = () => adjudication.promise
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: '/something' })
  surface.input.submit(); b.status.set(new Map([['s1', { running: false, pendingInteraction: { kind: 'question' } }]]))
  adjudication.resolve(undefined); await surface.whenSettled()
  assert.equal(b.prompts.length, 0); assert.equal(surface.state.getSnapshot().draft, '/something')
  assert.match(surface.notices.getSnapshot().text, /awaiting an interaction/)
  surface.dispose(); await surface.closed
})

test('composer blocks refuse ordinary messages but allow native command adjudication', async () => {
  const b = bench(); b.block.set({ reason: 'choose a model' })
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: 'message' })
  surface.input.submit(); await surface.whenSettled()
  assert.equal(b.prompts.length, 0); assert.equal(surface.state.getSnapshot().draft, 'message')
  let commands = 0
  b.adjudicate = async () => ({ claim: { name: 'args', token: '/args ', submit: async () => { commands++; return { kind: 'success' } } } })
  surface.input.setDraft('/args value'); surface.input.submit(); await surface.whenSettled()
  assert.equal(commands, 1); assert.equal(b.prompts.length, 0)
  surface.dispose(); await surface.closed
})

test('claimed command operation is retained through callback settlement and never reaches ordinary sink', async () => {
  const b = bench(), flight = deferred(); let commands = 0
  b.adjudicate = async () => ({ claim: { name: 'args', token: '/args ', submit: async (args, ctx) => { commands++; assert.equal(args, 'value'); assert.equal(ctx, b.binding.ctx); return flight.promise } } })
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: '/args value' })
  surface.input.submit(); await flush(); surface.dispose()
  assert.equal(commands, 1); assert.equal(b.releases, 0); assert.equal(b.prompts.length, 0)
  flight.resolve({ kind: 'success' }); await surface.closed
  assert.equal(b.releases, 1)
})

test('custom sink receives captured binding and its success warning cannot cause another prompt', async () => {
  const b = bench(); let calls = 0, captured
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: 'go', defaultSink: async args => { calls++; captured = args; return { kind: 'success' } } })
  surface.input.submit(); await surface.whenSettled()
  surface.input.notify('info', 'Goal recovery unavailable')
  assert.equal(calls, 1); assert.equal(captured.binding, b.binding); assert.equal(captured.text, 'go')
  assert.equal(surface.state.getSnapshot().draft, ''); assert.equal(b.prompts.length, 0)
  surface.dispose(); await surface.closed
})

test('references retain through asynchronous serialization; closing before admission never sends', async () => {
  const b = bench(), serialization = deferred(); b.serialize = () => serialization.promise
  const surface = await createInputSurface(b.ctx, { sessionId: 's1' })
  surface.input.insertReference({ source: 'reference', ref: 'one', label: 'one', clipboardText: '@one' }, { start: 0, end: 0, draftRev: 0 })
  surface.input.submit(); await flush(); surface.dispose()
  assert.equal(b.releases, 0)
  serialization.resolve('expanded reference'); await surface.closed
  assert.equal(b.prompts.length, 0); assert.equal(b.releases, 1)
})

test('prompt rejection after View closes restores final draft before closed resolves', async () => {
  const b = bench(), flight = deferred(); b.prompt = () => flight.promise
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: 'save this on failure' })
  const observed = []
  const unsubscribe = surface.state.subscribe(() => observed.push(surface.state.getSnapshot().draft))
  surface.input.submit(); await flush(); surface.dispose()
  assert.equal(surface.state.getSnapshot().draft, '')
  flight.resolve({ ok: false, error: { message: 'admission denied' } })
  await surface.closed
  assert.equal(surface.state.getSnapshot().draft, 'save this on failure')
  assert.equal(observed.at(-1), 'save this on failure')
  assert.equal(b.releases, 1); assert.equal(b.prompts.length, 1)
  unsubscribe()
})

test('provider absence disables only createSurface and acquires no Session', async () => {
  const b = bench(), get = b.ctx.get
  b.ctx.get = key => key === 'commandUi' ? undefined : get(key)
  await assert.rejects(createInputSurface(b.ctx, { sessionId: 's1' }), /unavailable/)
  assert.equal(b.retains, 0); assert.equal(b.prompts.length, 0)
})

test('adjudication error retains slash text and never downgrades to a message', async () => {
  const b = bench(); b.adjudicate = async () => { throw new Error('catalog offline') }
  const surface = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: '/goal something' })
  surface.input.submit(); await surface.whenSettled()
  assert.equal(surface.state.getSnapshot().draft, '/goal something')
  assert.equal(surface.notices.getSnapshot().text, 'catalog offline')
  assert.equal(b.prompts.length, 0)
  surface.dispose(); await surface.closed
})

test('launcher focuses only its own editor before menu tracking and caller disable closes both layers', async () => {
  const b = bench(), surface = await createInputSurface(b.ctx, { sessionId: 's1' })
  const model = surface.View({}).props.surface, trigger = b.triggerSurfaces[0], popup = b.commandSurfaces[0].popup
  assert.equal(editors.at(-1).focusCount, 0)
  model.launchMenu('skill')
  assert.equal(trigger.launches.length, 1); assert.equal(trigger.launches[0].focusCount, 1)
  assert.equal(trigger.launches[0].source, 'skill')
  const previousDismissals = popup.dismissals
  model.setDisabled(true)
  assert.equal(trigger.target.isAvailable(), false)
  assert.ok(popup.dismissals > previousDismissals); assert.ok(trigger.dismissals > 0)
  model.launchMenu('command'); surface.input.submit()
  assert.equal(trigger.launches.length, 1); assert.equal(b.prompts.length, 0)
  model.setDisabled(false); model.launchMenu('command')
  assert.equal(trigger.launches.length, 2)
  surface.dispose(); await surface.closed
})

test('combined launcher filters without editing captured draft and obeys disable gate', async () => {
  const b = bench(), h = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: '保留内容' })
  const model = h.View({}).props.surface, trigger = b.triggerSurfaces[0]
  model.launchMenu(); model.filterMenu('goal')
  assert.equal(trigger.launches[0].source, 'all'); assert.equal(trigger.launches[0].focusCount, 1)
  assert.equal(trigger.lastQuery, 'goal'); assert.equal(h.state.getSnapshot().draft, '保留内容')
  model.setDisabled(true); model.filterMenu('ignored'); model.launchMenu()
  assert.equal(trigger.lastQuery, 'goal'); assert.equal(trigger.launches.length, 1)
  h.dispose(); await h.closed
})

test('plus skill inserts a separator over the captured Chinese selection without losing its suffix', async () => {
  const b = bench(), h = await createInputSurface(b.ctx, { sessionId: 's1', initialDraft: '帮我待替换后文' })
  const target = b.triggerSurfaces[0].target
  const span = { start: 2, end: 5, draftRev: h.state.getSnapshot().draftRev }
  assert.equal(target.insertText('/using-claw-kit ', span, false, true), true)
  assert.equal(h.state.getSnapshot().draft, '帮我 /using-claw-kit 后文')
  assert.equal(target.insertText('/stale ', span, false, true), false)
  h.input.setDraft('帮我 /old 后文')
  assert.equal(target.insertText('/new ', { start: 3, end: 8, draftRev: h.state.getSnapshot().draftRev }, false, false), true)
  assert.equal(h.state.getSnapshot().draft, '帮我 /new 后文')
  h.dispose(); await h.closed
})

test('operation lifetime handles nested callbacks, synchronous throws and idempotent close', async () => {
  let released = 0, closed = 0
  const life = createSurfaceLifetime({ close: () => closed++, release: () => released++ })
  const flight = deferred()
  const work = life.withOperation(() => life.withOperation(() => flight.promise))
  assert.equal(life.flights, 2); life.dispose(); life.dispose()
  assert.equal(closed, 1); assert.equal(released, 0)
  flight.resolve(7); assert.equal(await work, 7); await life.closed; assert.equal(released, 1)
  await assert.rejects(life.withOperation(() => undefined), /closing/)
  const second = createSurfaceLifetime({ close() {}, release() {} })
  await assert.rejects(second.withOperation(() => { throw new Error('sync') }), /sync/)
  assert.equal(second.flights, 0); second.dispose(); await second.closed
})
