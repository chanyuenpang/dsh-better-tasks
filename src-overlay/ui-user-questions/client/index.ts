/**
 * Web question plugin, browser half: QuestionComposer registered as a
 * selector-routed entry of the conversation-declared composer chain, plus the
 * `question` dictionaries. The selector narrows the owner's currency to the
 * question carrier (matched prop), and the whole behavior surface rides the
 * carrier (domain encoding in contract/slots.ts PendingQuestion); copy rides
 * the standard locale seat. Export discipline: packages/client/AGENTS.md.
 *
 * One entry, two presentations: the composer renders a request with a
 * `plan-review` intent as the plan decision card and every other request as
 * the generic question flow. Both use the same carrier and composer seat.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactNode } from 'react'
import type { InboxWireState } from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PendingInteractionPublisher } from '@deepseek-ai/dsh-client-ui-session/client'
import type { TypertClientEventListener } from '@deepseek-ai/dsh-typert-protocol'
import type { AskUserQuestionItem, PendingUserQuestion, UserQuestionProjectionView } from '@deepseek-ai/dsh-user-questions/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { UserQuestionPanels, UserQuestionRecord } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createWaterfallRequest, PendingQuestion, type QuestionComposerProps, type QuestionRpcChannel } from './contract/slots.ts'
import { QuestionComposer, QuestionSurface } from './QuestionComposer.tsx'
import { QuestionSurfaceRegistry, type QuestionSurfaceProvider } from './question-surface.ts'
import { createQuestionCard, createQuestionCardHook, findQuestionCard, queuedQuestionReplies, runQuestionOperation } from './surface-card.tsx'
import { answeredQuestionDefinition, questionReplyDefinition } from './question-reply.ts'
import { QuestionReplyView } from './QuestionReplyView.tsx'
import { en, ja, es, fr, de, ru, pt, zh, type QuestionKey } from './locales.ts'
import composerCss from './QuestionComposer.module.css'
import reviewCss from './PlanReviewPanel.module.css'

export type {
  PendingQuestion, PlanReview, QuestionAnswer, QuestionComposerProps, QuestionWait,
} from './contract/slots.ts'
export type { QuestionKey } from './locales.ts'
export type { QuestionCardTarget, QuestionCardOptions, QuestionCardHandle, QuestionCardState, QuestionCardViewProps } from './surface-card.tsx'
export type { QuestionSurfaceProvider } from './question-surface.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The question composer's copy. */
    question: QuestionKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'question'

type QuestionListener = TypertClientEventListener<'user-questions/request'>
type ClientQuestionRequest = Parameters<QuestionListener>[0]
type ClientQuestionNext = Parameters<QuestionListener>[1]
type ClientQuestionAnswer = Awaited<ReturnType<QuestionListener>>

/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, conversation nodes, and copy. */
export const inject: string[] = ['sessions', 'remote', 'remote.userQuestions', 'uiSession', 'slots', 'locale', 'uiConversation']

/** One card and the composer seat it moves in and out of. */
interface QuestionCard {
  readonly pending: PendingQuestion
  /** Withdraw the panel from the composer seat; the request and its countdown stand. */
  readonly hide: () => void
  /** Publish the panel last, so it wins the seat against any other pending question. */
  readonly reveal: () => void
  /** Drop the card for good: the projection no longer lists its call. */
  readonly remove: () => void
  /** Track forwarded requests through claim opening and waterfall settlement. */
  readonly trackRequest: (completion: Promise<void>) => () => void
  /** Whether the forwarded request is still opening or waiting for settlement. */
  readonly hasRequest: () => boolean
}

/**
 * Cards published to the Session pending-interaction registry, keyed by
 * `PendingQuestion.key`. A tool-call-keyed card is shared by the forwarded
 * waterfall and the Session projection.
 *
 * A card outlives its seat. Closing the panel only unpublishes it, which keeps
 * the request answerable from its tool call row, so this registry — not the
 * pending-interaction registry — decides when a request is over.
 */
class QuestionCards {
  readonly #cards = new Map<string, QuestionCard>()
  readonly #listeners = new Map<string, Set<() => void>>()

  constructor(private readonly publish: PendingInteractionPublisher<PendingQuestion>, private readonly removed: (pending: PendingQuestion) => void) {}

  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.#listeners.get(key) ?? new Set<() => void>()
    listeners.add(listener); this.#listeners.set(key, listeners)
    return () => { listeners.delete(listener); if (listeners.size === 0) this.#listeners.delete(key) }
  }

  #notify(key: string): void { for (const listener of [...(this.#listeners.get(key) ?? [])]) listener() }

  byCallId(sessionId: SessionId, callId: string): QuestionCard | undefined {
    return this.#cards.get(PendingQuestion.keyOf(sessionId, callId))
  }

  /** Observable state for one card while the registry owns it. */
  source(key: string): PendingQuestion | undefined {
    return this.#cards.get(key)?.pending
  }

  values(): readonly QuestionCard[] {
    return [...this.#cards.values()]
  }

  /** Keys of every card registered for one Session. */
  keysFor(sessionId: SessionId): readonly string[] {
    return this.values().filter(card => card.pending.sessionId === sessionId).map(card => card.pending.key)
  }

  /**
   * Return the card of a tool call, creating and publishing it when absent.
   * A request without a call id always gets a fresh card.
   */
  ensure(sessionId: SessionId, questions: readonly AskUserQuestionItem[], callId: ToolCallId | undefined): QuestionCard {
    if (callId !== undefined) {
      const existing = this.byCallId(sessionId, callId)
      if (existing !== undefined) return existing
    }
    return this.#create(new PendingQuestion(sessionId, questions, callId, () => this.keysFor(sessionId)))
  }

  /** Publish one carrier into the composer seat and register the card that owns it. */
  #create(pending: PendingQuestion): QuestionCard {
    const requests = new Set<Promise<void>>()
    const delegate = async (): Promise<void> => {
      pending.delegate()
      await Promise.all(requests)
    }
    // Republishing is how a revealed card reaches the seat: the registry keeps
    // the last entry of equal precedence, and it rejects a duplicate key.
    let unpublish: (() => void) | undefined = this.publish(pending, delegate)
    const card: QuestionCard = {
      pending,
      hide: () => {
        unpublish?.()
        unpublish = undefined
      },
      reveal: () => {
        unpublish?.()
        unpublish = this.publish(pending, delegate)
      },
      remove: () => {
        /* v8 ignore next -- a card leaves the registry once; no caller holds a card the registry already replaced. */
        if (this.#cards.get(pending.key) !== card) return
        this.#cards.delete(pending.key)
        pending.close()
        this.removed(pending)
        unpublish?.()
        unpublish = undefined
        this.#notify(pending.key)
      },
      trackRequest: (completion) => {
        requests.add(completion)
        return () => { requests.delete(completion) }
      },
      hasRequest: () => requests.size > 0,
    }
    // A review card has no request left to park: closing it drops the card, and
    // the tool call row builds another one from the same transcript record.
    pending.attachSeat({ hide: pending.review === undefined ? card.hide : card.remove })
    this.#cards.set(pending.key, card)
    this.#notify(pending.key)
    return card
  }

  /**
   * Show the panel of one answerable tool call.
   * @param sessionId - Session the tool call belongs to.
   * @param callId - `ask_user_question` call whose panel to show, as its
   * transcript row spells it.
   * @returns whether a card for that call is still answerable.
   */
  reveal(sessionId: SessionId, callId: string): boolean {
    const card = this.byCallId(sessionId, callId)
    if (card === undefined) return false
    card.reveal()
    return true
  }

  /**
   * Show one settled tool call's recorded answers as a read-only card. A call
   * that somehow still holds a card is shown as it stands, so a live request is
   * never replaced by a stale copy of itself.
   * @param sessionId - Session the tool call belongs to.
   * @param callId - `ask_user_question` call whose record to show, as its
   * transcript row spells it.
   * @param record - the call's questions and recorded answers.
   * @returns true; a record always produces a card.
   */
  review(sessionId: SessionId, callId: string, record: UserQuestionRecord): boolean {
    const card = this.byCallId(sessionId, callId) ?? this.#create(new PendingQuestion(
      sessionId,
      record.questions,
      brandString<ToolCallId>(callId),
      () => this.keysFor(sessionId),
      record.answers,
    ))
    card.reveal()
    return true
  }

  /**
   * Hand every live waterfall back at plugin teardown. The pending-interaction
   * registry only drains what it currently holds, and a hidden card is not in
   * it, so its Host request would wait for its own abort instead.
   */
  dispose(): void {
    for (const card of this.values()) {
      card.pending.delegate()
      card.remove()
    }
  }
}

/** Present one forwarded request through its card until the waterfall settles. */
async function answerQuestion(
  ctx: ClientContext,
  owner: ClientContext,
  request: ClientQuestionRequest,
  next: ClientQuestionNext,
  cards: QuestionCards,
): Promise<ClientQuestionAnswer> {
  const sessionId = ctx.sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  const callId = request.wait?.callId
  const card = cards.ensure(sessionId, request.questions, callId)
  const claimLifetime = new AbortController()
  const claimSignal = request.signal === undefined ? claimLifetime.signal
    : AbortSignal.any([claimLifetime.signal, request.signal])
  let claim: ReturnType<typeof ctx.remote.userQuestions.attachWait> | undefined
  let claimEnded: Promise<never> | undefined
  let delegateRequest: (() => void) | undefined
  const releaseClaim = request.wait?.timed === true && callId !== undefined
    ? ctx.effect(() => {
      claim = ctx.remote.userQuestions.attachWait(sessionId, callId, claimSignal)
      return async () => {
        delegateRequest?.()
        claimLifetime.abort()
        claim?.dispose()
        if (claimEnded !== undefined) await Promise.allSettled([claimEnded])
      }
    }, 'ui-user-questions: foreground claim')
    : undefined
  const completed = Promise.withResolvers<void>()
  const finishRequest = card.trackRequest(completed.promise)
  try {
    const iterator = claim?.[Symbol.asyncIterator]()
    const opening = iterator === undefined ? undefined : await iterator.next()
    if (opening?.done === true) return await next()
    const waterfall = createWaterfallRequest(
      opening === undefined ? undefined : Date.now() + opening.value.remainingMs,
      claimSignal,
      (channel) => { card.pending.detachWaterfall(channel) },
    )
    // Cancellation may win between the first claim frame and this continuation.
    // The request has already settled, so its channel must never reach the card.
    if (claimSignal.aborted) return await waterfall.result
    delegateRequest = () => { waterfall.channel.delegate() }
    card.pending.attachWaterfall(waterfall.channel)
    if (iterator !== undefined) {
      claimEnded = (async () => {
        await iterator.next()
        throw new Error('the foreground question wait ended')
      })()
    }
    try {
      return await (claimEnded === undefined ? waterfall.result : Promise.race([waterfall.result, claimEnded]))
    } catch (error) {
      if (waterfall.isDelegation(error)) {
        await releaseClaim?.()
        return await next()
      }
      throw error
    }
  } finally {
    if (releaseClaim === undefined) claimLifetime.abort()
    else if (claimEnded === undefined) await releaseClaim()
    else {
      // The Host closes the claim after accepting the waterfall outcome.
      // A local return precedes transmission and cannot release that claim.
      void Promise.allSettled([claimEnded]).then(() => { void releaseClaim() })
    }
    // A blocking request without a call id is not in the projection; its card ends with its waterfall.
    if (callId === undefined) card.remove()
    // A timed waterfall ending may leave this same call continued. Its shared
    // gate/drafts remain owned until the card actually leaves the registry.
    completed.resolve()
    finishRequest()
  }
}

/**
 * Mirror answerable calls onto cards. A submitted reply in the durable Inbox
 * removes the editable card until the reply is admitted or discarded.
 */
function publishContinuedQuestions(ctx: ClientContext, cards: QuestionCards): { reconcile(): void; dispose(): void } {
  const sessions = ctx.sessions
  const stopProjections = new Map<SessionId, { binding: NonNullable<ReturnType<typeof sessions.binding>>; stop(): void }>()

  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const rpcFor = (sessionId: SessionId, callId: ToolCallId): QuestionRpcChannel => ({
    answer: async answer => unwrap(await ctx.remote.userQuestions.answer(sessionId, callId, answer)),
  })

  const reconcile = (): void => {
    const snapshot = sessions.list.getSnapshot()
    const bound = new Map(Object.values(snapshot.byId).flatMap((summary) => {
      const binding = sessions.binding(summary.id)
      return binding === undefined ? [] : [[summary.id, binding] as const]
    }))
    for (const [sessionId, entry] of stopProjections) {
      if (bound.get(sessionId) === entry.binding) continue
      entry.stop()
      stopProjections.delete(sessionId)
    }
    for (const [sessionId, binding] of bound) {
      if (stopProjections.has(sessionId)) continue
      const stopQuestions = binding.session.projections.faceOf('userQuestions').subscribe(reconcile)
      const stopInbox = binding.session.projections.faceOf('inbox').subscribe(reconcile)
      stopProjections.set(sessionId, { binding, stop: () => { stopQuestions(); stopInbox() } })
    }
    const rows = new Map<string, { sessionId: SessionId; row: PendingUserQuestion }>()
    for (const [sessionId, binding] of bound) {
      const projected = binding.session.projections.faceOf('userQuestions').getSnapshot() as
        UserQuestionProjectionView | undefined
      const inbox = binding.session.projections.faceOf('inbox').getSnapshot() as InboxWireState | undefined
      const queued = queuedQuestionReplies(inbox)
      for (const row of projected?.active ?? []) {
        if (row.state === 'continued' && queued.has(row.callId)) continue
        rows.set(PendingQuestion.keyOf(sessionId, row.callId), { sessionId, row })
      }
    }
    for (const { sessionId, row } of rows.values()) {
      if (row.state === 'continued') {
        const card = cards.ensure(sessionId, row.questions, row.callId)
        card.pending.attachRpc(rpcFor(sessionId, row.callId))
        card.pending.setState('continued')
        continue
      }
      cards.byCallId(sessionId, row.callId)?.pending.setState('open')
    }
    for (const card of cards.values()) {
      // A review card's call already settled, so the projection no longer lists it as answerable.
      if (card.pending.callId === undefined
        || card.pending.review !== undefined
        || rows.has(card.pending.key)
        || card.hasRequest()
        || card.pending.hasWaterfall()) continue
      card.remove()
    }
  }

  reconcile()
  const stopList = sessions.list.subscribe(reconcile)
  return { reconcile, dispose: () => {
    stopList()
    for (const entry of stopProjections.values()) entry.stop()
    stopProjections.clear()
  } }
}

/**
 * Task-card presentation for a host-mounted surface. Scoped by the
 * `data-question-surface` discriminator so it cannot reach the composer seat,
 * and built from this package's own class maps so a CSS-module hash change
 * cannot silently detach it.
 * @returns the stylesheet text for the `task-card` variant.
 */
function taskCardCss(): string {
  const c = composerCss
  const r = reviewCss
  const scope = '[data-question-surface="task-card"]'
  const font = 'var(--dsh-question-card-font-size,var(--dbt-projection-font-size,13px))'
  return [
    `${scope}{min-width:0;max-width:100%;overflow:hidden;font-size:${font};line-height:1.5}`,
    `${scope} .${c.frame},${scope} .${r.frame}{display:block;padding:4px 0 0}`,
    `${scope} .${c.card},${scope} .${r.card}{width:100%;min-width:0;max-width:none;max-height:min(55vh,420px);border-radius:10px;box-shadow:none}`,
    `${scope} .${c.header}{gap:6px;flex-wrap:wrap;padding:9px 8px 6px 10px}`,
    `${scope} .${c.headerActions}{min-width:0;flex-wrap:wrap}`,
    `${scope} .${c.title}{overflow-wrap:anywhere;font-size:${font};line-height:1.5}`,
    `${scope} .${c.body}{min-width:0;padding:8px 10px 2px;font-size:${font};line-height:1.5}`,
    `${scope} .${c.footer},${scope} .${r.footer}{min-width:0;flex-wrap:wrap;gap:7px;padding:7px 10px 9px}`,
    `${scope} .${c.footerActions},${scope} .${r.actions}{min-width:0;flex-wrap:wrap}`,
    `${scope} .${c.footerActions}{gap:6px}`,
    `${scope} .${c.footerActions} button{height:auto;min-height:28px;padding:4px 9px;font-size:${font};line-height:1.5}`,
    `${scope} button,${scope} textarea{font-family:inherit;font-size:inherit;line-height:inherit}`,
    `${scope} .${c.option}{min-width:0;padding:8px 9px;font-size:${font};line-height:1.5}`,
    `${scope} .${c.optionLabel}{overflow-wrap:anywhere;font-size:${font};line-height:1.5}`,
    `${scope} .${c.description}{overflow-wrap:anywhere;font-size:${font};line-height:1.5}`,
    `${scope} .${c.fieldMirror},${scope} .${c.fieldInput}{font-size:${font};line-height:1.5}`,
    `${scope} .${c.eyebrow},${scope} .${c.progress},${scope} .${c.feedback},${scope} .${c.waitStatus},${scope} .${c.badge}{font-size:${font};line-height:1.5;white-space:normal}`,
    `${scope} .${c.number}{font-size:${font};line-height:1.2;flex:0 0 1.5em;min-width:20px;width:1.5em;height:1.5em;margin-top:0}`,
    `${scope} .${c.waitButton}{font-size:${font};line-height:1.5;height:auto;min-height:28px;padding:4px 9px}`,
  ].join('')
}

/**
 * Client plugin body: register the `question` dictionaries, the question
 * composer into the composer chain, and the late-reply conversation node.
 * Zero business face — data and verbs live on the matched carrier; t rides
 * the standard locale seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-user-questions: dictionaries')
  const registerPendingInteraction = ctx.uiSession.registerPendingInteraction<PendingQuestion>(
    pending => pending.kind === 'plan-review' ? 2 : 1,
  )
  const cards = new QuestionCards(registerPendingInteraction, pending => { registry.forget(pending) })
  ctx.effect(() => () => { cards.dispose() }, 'ui-user-questions: cards')
  // One draft store and one settlement gate for every surface that presents a
  // question, including a host-mounted one (the Better Tasks task card). Both
  // seams coexist: `userQuestionPanels` stays the native seat protocol, and
  // `questionSurface` is the render-into-my-own-seat protocol a host uses.
  const t = ctx.locale.bind(NS)
  const registry = new QuestionSurfaceRegistry({
    isCurrent: pending => cards.source(pending.key) === pending,
    bindingOf: sessionId => ctx.sessions.binding(sessionId as SessionId),
    runOperation: (record, send) => runQuestionOperation(ctx, record, send),
    resubmitMessage: () => t('error.resubmit'),
  })
  const continuation = publishContinuedQuestions(ctx, cards)
  ctx.effect(() => continuation.dispose, 'ui-user-questions: continued questions')
  const supported = (pending: unknown): pending is PendingQuestion => pending instanceof PendingQuestion
    && pending.kind === 'question' && pending.review === undefined && !pending.snapshot().closed
    && cards.source(pending.key) === pending && ctx.sessions.binding(pending.sessionId) !== undefined
  const questionSurface: QuestionSurfaceProvider = Object.freeze({
    find: sessionId => findQuestionCard(ctx, cards, sessionId),
    createCard: options => createQuestionCard(ctx, cards, registry, continuation.reconcile, options, t),
    isSupported: supported,
    render: (pending: unknown, variant = 'task-card') => supported(pending)
      ? createElement(QuestionSurface, {
        pending, registry, variant, store: registry.storeFor(pending.sessionId), t,
        useQuestionCard: createQuestionCardHook(pending), renderSlot: () => null,
        isAvailable: () => supported(pending),
      }) : null,
  })
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('questionSurface', questionSurface)
    return () => {
      dispose()
      registry.dispose()
    }
  }, 'ui-user-questions: shared surface')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@deepseek-ai/dsh-client-ui-user-questions'
    style.dataset.pluginCss = '@deepseek-ai/dsh-client-ui-user-questions/task-card'
    style.textContent = taskCardCss()
    document.head.appendChild(style)
    return () => style.remove()
  }, 'ui-user-questions: task-card styles')
  const disposePanels = ctx.reflect.provide('userQuestionPanels', {
    reveal: (sessionId, callId) => cards.reveal(sessionId, callId),
    review: (sessionId, callId, record) => cards.review(sessionId, callId, record),
  } satisfies UserQuestionPanels)
  ctx.effect(() => disposePanels, 'ui-user-questions: answer panels')
  const registeredComposer = (props: QuestionComposerProps): ReactNode => createElement(QuestionComposer, { ...props, registry })
  // No render boundary wraps this entry, and that is deliberate.
  //
  // `conversation.composer` is an overlay chain whose owner renders the native input
  // bar as its fallback. A boundary here would catch a crash inside our entry and
  // render its own crash face in the elected slot, so the fallback the chain exists
  // to provide would never appear — a mis-bind replaced the whole input bar with a
  // silent placeholder. The chain's own contract already covers failure: decline the
  // election and the owner's native composer renders unchallenged. So the selector
  // declines on throw, and this package contributes a question composer only when it
  // can actually render one.
  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    {
      name: 'conversation.composer',
      select: ({ pendingInteraction }: ComposerChainProps): PendingQuestion | null => {
        try {
          return pendingInteraction instanceof PendingQuestion ? pendingInteraction : null
        } catch {
          return null
        }
      },
      locale: NS,
      store: registry.draftStore,
      inject: () => ({ keyedHooks: { questionCard: (key: string) => cards.source(key) } }),
      children: { 'conversation.plan-review.actions': { kind: 'list', scope: 'session' } },
    },
    registeredComposer,
  ))
  ctx.uiConversation.events.register(questionReplyDefinition)
  ctx.uiConversation.events.register(answeredQuestionDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'question-reply',
    locale: NS,
  }, QuestionReplyView))
  ctx.remote.$on('user-questions/request', function (request, next) {
    return answerQuestion(ctx, this, request, next, cards)
  })
}