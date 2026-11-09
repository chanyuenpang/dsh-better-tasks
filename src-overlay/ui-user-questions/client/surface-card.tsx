import { createElement, useSyncExternalStore, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InboxWireState } from '@deepseek-ai/dsh-agent/types'
import type { UserQuestionProjectionView } from '@deepseek-ai/dsh-user-questions/types'
import { PendingQuestion, planReviewOf, type QuestionCardSnapshot, type QuestionComposerProps } from './contract/slots.ts'
import { QuestionSurface } from './QuestionComposer.tsx'
import type { QuestionSurfaceRecord, QuestionSurfaceRegistry } from './question-surface.ts'

export interface QuestionCardTarget {
  readonly sessionId: string
  readonly requestKey: string
  readonly callId?: string
  readonly kind: 'question' | 'plan-review'
}
export interface QuestionCardOptions {
  readonly sessionId: string
  readonly requestKey?: string
  readonly callId?: string
  readonly signal?: AbortSignal
}
export interface QuestionCardViewProps { readonly fontSize?: number; readonly className?: string }
export interface QuestionCardState {
  readonly phase: 'waiting' | 'ready' | 'closed' | 'unsupported' | 'error'
  readonly kind?: 'question' | 'plan-review'
  readonly message?: string
}
export interface QuestionCardHandle {
  readonly sessionId: string
  readonly requestKey: string
  readonly callId?: string
  readonly state: ObservableSnapshot<QuestionCardState>
  readonly View: ComponentType<QuestionCardViewProps>
  readonly closed: Promise<void>
  dispose(): void
}
export interface QuestionCardsAccess {
  source(key: string): PendingQuestion | undefined
  values(): readonly { readonly pending: PendingQuestion }[]
  subscribe(key: string, listener: () => void): () => void
}

/** Same durable Inbox exclusion as the native continued-question reconciler. */
export function queuedQuestionReplies(inbox: InboxWireState | undefined): ReadonlySet<string> {
  const queued = new Set<string>()
  for (const message of [...(inbox?.['next-step'] ?? []), ...(inbox?.['next-turn'] ?? [])]) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
    const source = message.source
    if (typeof source === 'object' && source !== null && !Array.isArray(source)
      && source.kind === 'user-question-reply' && typeof source.callId === 'string') queued.add(source.callId)
  }
  return queued
}

function projections(sessions: ISessions, sessionId: SessionId): { questions: UserQuestionProjectionView | undefined; inbox: InboxWireState | undefined } {
  const binding = sessions.binding(sessionId)
  const list = sessions.list.getSnapshot()
  const metadata = list.byId[sessionId]?.projectionValues ?? list.projectionsBySession[sessionId]?.values
  return {
    questions: binding?.session.projections.faceOf('userQuestions').getSnapshot() ?? metadata?.userQuestions,
    inbox: (binding?.session.projections.faceOf('inbox').getSnapshot() ?? metadata?.inbox) as InboxWireState | undefined,
  }
}
function targetOf(pending: PendingQuestion): QuestionCardTarget {
  return { sessionId: pending.sessionId, requestKey: pending.key, kind: pending.kind,
    ...(pending.callId === undefined ? {} : { callId: pending.callId }) }
}

/** Discover existing data only. The caller's existing list/status hooks drive refresh. */
export function findQuestionCard(ctx: Context, cards: QuestionCardsAccess, sessionId: string): QuestionCardTarget | undefined {
  const sessions = ctx.get('sessions') as ISessions | undefined
  if (sessions === undefined || sessionId === '') return undefined
  const id = sessionId as SessionId, view = projections(sessions, id), queued = queuedQuestionReplies(view.inbox)
  const answerable = (pending: PendingQuestion): boolean => pending.sessionId === id && pending.review === undefined
    && !pending.snapshot().closed && cards.source(pending.key) === pending
    && !(pending.snapshot().state === 'continued' && pending.callId !== undefined && queued.has(pending.callId))
  const active = ctx.get('uiSession')?.sessionStatus.getSnapshot().get(id)?.pendingInteraction
  if (active instanceof PendingQuestion && answerable(active)) return targetOf(active)
  const live = cards.values().map(({ pending }) => pending).filter(answerable)
  const current = live.filter(pending => pending.kind === 'plan-review').at(-1) ?? live.at(-1)
  if (current !== undefined) return targetOf(current)
  const candidates = new Map<string, QuestionCardTarget>()
  for (const row of view.questions?.active ?? []) {
    if (row.state === 'continued' && queued.has(row.callId)) continue
    candidates.set(PendingQuestion.keyOf(id, row.callId), { sessionId, callId: row.callId,
      requestKey: PendingQuestion.keyOf(id, row.callId), kind: planReviewOf(row.questions) === undefined ? 'question' : 'plan-review' })
  }
  const values = [...candidates.values()]
  return values.filter(value => value.kind === 'plan-review').at(-1) ?? values.at(-1)
}

/** Bind the real PendingQuestion observable, rather than pretending source(key) is a React hook. */
export function createQuestionCardHook(pending: PendingQuestion): QuestionComposerProps['useQuestionCard'] {
  return ((key: string, select?: (value: QuestionCardSnapshot | undefined) => unknown) => {
    const snapshot = useSyncExternalStore(pending.subscribe, pending.getSnapshot, pending.getSnapshot)
    const value = key === pending.key ? snapshot : undefined
    return select === undefined ? value : select(value)
  }) as QuestionComposerProps['useQuestionCard']
}

/** Retain one exact Session generation and one exact request; never navigate or reveal a native seat. */
export async function createQuestionCard(
  ctx: Context, cards: QuestionCardsAccess, registry: QuestionSurfaceRegistry,
  reconcile: () => void, options: QuestionCardOptions, t: QuestionComposerProps['t'],
): Promise<QuestionCardHandle> {
  const sessions = ctx.get('sessions') as ISessions | undefined
  if (sessions === undefined) throw new Error('Session retention is unavailable')
  if (typeof options.sessionId !== 'string' || options.sessionId === '') throw new Error('A question Session is required')
  const id = options.sessionId as SessionId
  if (options.requestKey === undefined && options.callId === undefined) throw new Error('An exact question identity is required')
  if (options.callId !== undefined && (typeof options.callId !== 'string' || options.callId === '')) throw new Error('Invalid question call identity')
  const key = options.requestKey ?? PendingQuestion.keyOf(id, options.callId!)
  if (typeof key !== 'string' || key === '') throw new Error('Invalid question request identity')
  if (options.callId !== undefined && key !== PendingQuestion.keyOf(id, options.callId)) throw new Error('Question key and call identity disagree')
  options.signal?.throwIfAborted()
  const originalPending = cards.source(key)
  const reference = sessions.retain(id, { source: 'controllerOperation', signal: options.signal })
  let handedOff = false
  try {
    const binding = reference.binding
    if (await reference.ready !== binding) throw new Error('Question Session generation changed')
    options.signal?.throwIfAborted()
    if (sessions.binding(id) !== binding || binding.session.getSnapshot().removed || binding.session.getSnapshot().openState !== 'open') {
      throw new Error('Question Session is unavailable')
    }
    const state = createSnapshotStore<QuestionCardState>({ phase: 'waiting' })
    const ended = Promise.withResolvers<void>()
    const stops: Array<() => void> = []
    let closing = false, pending: PendingQuestion | undefined, record: QuestionSurfaceRecord | undefined
    let stopPending: (() => void) | undefined, removeOwner: (() => unknown) | undefined, removeGeneration: (() => unknown) | undefined
    const available = (): boolean => !closing && sessions.binding(id) === binding && !binding.session.getSnapshot().removed
      && binding.session.getSnapshot().openState === 'open'
      && pending !== undefined && cards.source(key) === pending && pending.sessionId === id && pending.key === key
      && (options.callId === undefined || pending.callId === options.callId) && !pending.snapshot().closed
      && !(pending.snapshot().state === 'continued' && pending.callId !== undefined
        && queuedQuestionReplies(projections(sessions, id).inbox).has(pending.callId))
    const publish = (next: QuestionCardState): void => {
      const old = state.getSnapshot()
      if (old.phase !== next.phase || old.kind !== next.kind || old.message !== next.message) state.set(next)
    }
    const finish = (terminal: QuestionCardState): void => {
      if (closing) return
      closing = true
      // Start the drain before notifying consumers, which may synchronously unmount.
      // Cleanup failures must neither reject `closed` nor strand the exact lease.
      const cleanups = [stopPending, ...stops.splice(0), removeOwner, removeGeneration]
      options.signal?.removeEventListener('abort', dispose)
      const drain = async (): Promise<void> => {
        try {
          for (const off of cleanups) {
            try { await off?.() } catch { /* Presentation cleanup is best effort. */ }
          }
          if (record !== undefined) await registry.whenSettled(record)
        } catch { /* A failed admitted operation still ends this presentation. */ }
        finally {
          try { reference.release() } catch { /* Generation teardown may already have run. */ }
          finally { ended.resolve() }
        }
      }
      void drain()
      publish(terminal)
    }
    const dispose = (): void => { finish({ phase: 'closed' }) }
    const observe = (): void => {
      if (closing) return
      if (sessions.binding(id) !== binding || binding.session.getSnapshot().removed) { dispose(); return }
      const sessionState = binding.session.getSnapshot()
      if (sessionState.openState === 'error') { finish({ phase: 'error', message: 'Question Session is unavailable' }); return }
      if (sessionState.openState !== 'open') { publish({ phase: 'waiting' }); return }
      const candidate = cards.source(key)
      if (originalPending !== undefined && candidate !== originalPending) { dispose(); return }
      if (candidate !== undefined) {
        if (candidate.sessionId !== id || candidate.key !== key || options.callId !== undefined && candidate.callId !== options.callId) {
          finish({ phase: 'error', message: 'Question identity changed' }); return
        }
        if (pending !== undefined && candidate !== pending) { dispose(); return }
        if (candidate.review !== undefined || candidate.snapshot().closed) { dispose(); return }
        if (candidate.kind === 'plan-review') { finish({ phase: 'unsupported', kind: 'plan-review' }); return }
        if (pending === undefined) {
          pending = candidate; record = registry.record(candidate)
          stopPending = candidate.subscribe(observe)
        }
        const data = projections(sessions, id)
        if (candidate.snapshot().state === 'continued' && candidate.callId !== undefined && queuedQuestionReplies(data.inbox).has(candidate.callId)) {
          finish({ phase: 'closed', kind: candidate.kind }); return
        }
        publish({ phase: candidate.snapshot().channel === 'none' ? 'waiting' : 'ready', kind: candidate.kind })
        return
      }
      if (pending !== undefined) { dispose(); return }
      const data = projections(sessions, id)
      const row = data.questions?.active.find(value => PendingQuestion.keyOf(id, value.callId) === key)
      if (row !== undefined && !(row.state === 'continued' && queuedQuestionReplies(data.inbox).has(row.callId))) {
        const kind = planReviewOf(row.questions) === undefined ? 'question' : 'plan-review'
        if (kind === 'plan-review') finish({ phase: 'unsupported', kind })
        else publish({ phase: 'waiting', kind })
      } else if (data.questions !== undefined || options.callId === undefined) dispose()
    }
    const refresh = (): void => { if (!closing) { reconcile(); observe() } }
    const View = ({ fontSize, className }: QuestionCardViewProps): ReactNode => {
      const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot)
      if (snapshot.phase !== 'ready' || pending === undefined || !available()) return null
      const style = typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0
        ? { '--dsh-question-card-font-size': `${fontSize}px` } as CSSProperties : undefined
      return createElement('div', { className, style, 'data-question-card-key': key }, createElement(QuestionSurface, {
        pending, registry, variant: 'task-card', store: registry.storeFor(id), t,
        useQuestionCard: createQuestionCardHook(pending), renderSlot: () => null, isAvailable: available,
      }))
    }
    try {
      stops.push(cards.subscribe(key, observe))
      stops.push(binding.session.projections.faceOf('userQuestions').subscribe(refresh))
      stops.push(binding.session.projections.faceOf('inbox').subscribe(refresh))
      stops.push(binding.session.subscribe(observe))
      stops.push(sessions.list.subscribe(observe))
      options.signal?.addEventListener('abort', dispose, { once: true })
      removeOwner = ctx.effect(() => dispose, 'user-questions: card surface owner')
      removeGeneration = binding.ctx.effect(() => dispose, 'user-questions: card surface generation')
      reconcile(); observe()
      handedOff = true
      if (options.signal?.aborted) dispose()
      return { sessionId: id, requestKey: key, ...(options.callId === undefined ? {} : { callId: options.callId }),
        state, View, closed: ended.promise, dispose }
    } catch (error) { dispose(); handedOff = true; throw error }
  } finally { if (!handedOff) reference.release() }
}

/** A settlement lease is separate from its view's abort signal and starts synchronously. */
export function runQuestionOperation(ctx: Context, record: QuestionSurfaceRecord, send: () => Promise<void>): Promise<void> {
  const sessions = ctx.get('sessions') as ISessions | undefined
  if (sessions === undefined || sessions.binding(record.pending.sessionId) !== record.binding) return Promise.reject(new Error('Question Session generation changed'))
  const reference = sessions.retain(record.pending.sessionId, { source: 'controllerOperation' })
  void reference.ready.catch(() => {})
  try {
    const snapshot = (record.binding as SessionBinding).session.getSnapshot()
    if (reference.binding !== record.binding || snapshot.removed || snapshot.openState !== 'open') throw new Error('Question Session is unavailable')
    return Promise.resolve(send()).finally(() => { reference.release() })
  } catch (error) { reference.release(); return Promise.reject(error) }
}
