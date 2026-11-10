import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireBuild = createRequire(new URL('../.srcbuild/package.json', import.meta.url))
const ts = requireBuild('typescript')
const React = requireBuild('react')
const { renderToStaticMarkup } = requireBuild('react-dom/server')
const root = new URL('../.srcbuild/packages/client/ui-user-questions/src/client/', import.meta.url)
const composerSource = readFileSync(new URL('../src-overlay/ui-user-questions/client/QuestionComposer.tsx', import.meta.url), 'utf8')

function load(source, name, dependencies, globals = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { fileName: name, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  new Function('module', 'exports', 'require', ...Object.keys(globals), code)(module, module.exports, id => {
    if (!(id in dependencies)) throw new Error('Unexpected dependency ' + id)
    return dependencies[id]
  }, ...Object.values(globals))
  return module.exports
}
const slots = load(readFileSync(new URL('contract/slots.ts', root), 'utf8'), 'slots.ts', {})

function fixture({ variant = 'composer', options, locked = false, review, source = composerSource } = {}) {
  const effects = [], released = [], listeners = new Map()
  const eventTarget = {
    addEventListener: (name, fn) => listeners.set(fn, name),
    removeEventListener: (_name, fn) => listeners.delete(fn),
  }
  const pending = new slots.PendingQuestion('session-render', [{ id: 'q', question: 'Choose a route', options }], 'call-render', undefined, review)
  pending.setState('continued')
  pending.attachRpc({ answer: async () => {} })
  pending.releaseFocus = (_time, owner) => released.push(owner)
  const state = { progressByRequest: {} }
  const actions = { clear() {}, prune() {}, replace() {} }
  const record = { version: 0, locked, error: null }
  const registry = {
    record: () => record, subscribe: () => () => {}, isCurrent: () => true, canInteract: () => !locked,
    clearError() {}, beginSettlement: () => 1, settle: async (_record, _attempt, send) => send(),
  }
  const primitives = new Proxy({
    Button: ({ children, variant: _variant, ...props }) => React.createElement('button', props, children),
    Tooltip: ({ children }) => children,
    MarkdownText: ({ text }) => React.createElement('span', null, text),
  }, { get: (target, key) => key in target ? target[key] : () => null })
  const composer = load(source, 'QuestionComposer.tsx', {
    react: { ...React, useEffect: setup => effects.push(setup) },
    'react/jsx-runtime': requireBuild('react/jsx-runtime'),
    clsx: requireBuild('clsx'),
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
    './contract/slots.ts': slots,
    './PlanReviewPanel.tsx': { PlanReviewPanel: () => React.createElement('section', null, 'plan review') },
    './QuestionComposer.module.css': new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) }),
  }, { window: eventTarget, document: { ...eventTarget, hidden: false } })
  const kit = { t: key => key, useQuestionCard: (_key, selector) => selector(pending.snapshot()), renderSlot: () => null }
  const element = variant === 'composer'
    ? React.createElement(composer.QuestionComposer, { ...kit, matched: pending, registry, actions, useStore: selector => selector(state) })
    : React.createElement(composer.QuestionSurface, { ...kit, pending, registry, variant, store: {
      subscribe: () => () => {}, getSnapshot: () => state, actions,
    } })
  return { render: () => renderToStaticMarkup(element), effects, released, listeners, pending }
}

test('native composer actually renders an ordinary question through the shared surface', () => {
  const f = fixture({ options: [{ label: 'Safe (Recommended)' }] })
  const html = f.render()
  assert.match(html, /data-question-surface="composer"/)
  assert.match(html, /role="radio"[^>]*aria-checked="true"/)
  assert.match(html, /Choose a route/)
})

test('card and native seats receive their discriminator without changing autofocus policy', () => {
  assert.match(fixture().render(), /<textarea[^>]*autofocus=/)
  const html = fixture({ variant: 'task-card' }).render()
  assert.match(html, /data-question-surface="task-card"/)
  assert.doesNotMatch(html, /autofocus=/)
})

test('the shared gate reaches QuestionFlow and disables answer controls', () => {
  const html = fixture({ locked: true, options: [{ label: 'Safe' }] }).render()
  assert.match(html, /role="radio"[^>]*disabled=/)
  assert.match(html, /<textarea[^>]*disabled=/)
})

test('recorded answers render read-only instead of restoring an editable draft', () => {
  const html = fixture({ options: [{ label: 'Safe' }], review: [{ id: 'q', selected: ['Safe'] }] }).render()
  assert.match(html, /role="radio"[^>]*aria-checked="true"[^>]*disabled=/)
  assert.doesNotMatch(html, /<textarea/)
})

test('focus effects clean up with a distinct owner for each mounted seat', () => {
  const owners = []
  for (const variant of ['composer', 'task-card']) {
    const f = fixture({ variant })
    f.render()
    const cleanups = f.effects.map(setup => setup()).filter(fn => typeof fn === 'function')
    for (const cleanup of cleanups.reverse()) cleanup()
    assert.equal(f.listeners.size, 0)
    assert.equal(f.released.length, 1)
    assert.equal(typeof f.released[0], 'object')
    owners.push(f.released[0])
  }
  assert.notEqual(owners[0], owners[1])
})

test('runtime regression detects the original missing import, props and focus owner', () => {
  assert.throws(() => fixture({ source: composerSource.replace('useState, useSyncExternalStore,', 'useState,') }).render(), /useSyncExternalStore is not defined/)
  assert.throws(() => fixture({ source: composerSource.replace('actions, gate, cardSurface = false', 'actions') }).render(), /gate is not defined/)
  const f = fixture({ source: composerSource.replace('const focusOwner = useRef<object>({})', '') })
  f.render()
  const cleanups = f.effects.map(setup => setup()).filter(fn => typeof fn === 'function')
  assert.throws(() => cleanups.forEach(cleanup => cleanup()), /focusOwner is not defined/)
})
