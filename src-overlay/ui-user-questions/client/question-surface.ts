/** Shared Session-scoped drafts and single-flight settlement for native and card seats. */
import { createQuestionDraftStore } from './draft-store.ts'
import type { PendingQuestion, QuestionCardSnapshot } from './contract/slots.ts'
import type { QuestionCardHandle, QuestionCardOptions, QuestionCardTarget } from './surface-card.tsx'

type DraftHandle = ReturnType<typeof createQuestionDraftStore>
export type QuestionSurfaceStore = ReturnType<DraftHandle['create']>
type Channel = QuestionCardSnapshot['channel']
interface Attempt {
  readonly id: number
  channel: Channel
  readonly completion: Promise<void>
  readonly finish: () => void
}
export interface QuestionSurfaceRecord {
  readonly id: string
  readonly pending: PendingQuestion
  readonly binding: unknown
  readonly store: QuestionSurfaceStore
  locked: boolean
  error: string | null
  version: number
  alive: boolean
  sentVia: Channel
  attempt: Attempt | undefined
  readonly listeners: Set<() => void>
  offPending: () => void
}
export interface QuestionSurfaceGate {
  readonly locked: boolean
  readonly error: string | null
  beginSettlement(): boolean
  settle(send: () => Promise<void>, channel?: Channel): Promise<void>
  canInteract(): boolean
  clearError(): void
}
export interface QuestionSurfaceRegistryOptions {
  isCurrent(pending: PendingQuestion): boolean
  bindingOf(sessionId: string): unknown
  runOperation(record: QuestionSurfaceRecord, send: () => Promise<void>): Promise<void>
  resubmitMessage(): string
}

/** One store instance per resolved persistence key; card and Slot share the actual object. */
export class QuestionSurfaceRegistry {
  readonly #records = new Map<string, QuestionSurfaceRecord>()
  readonly #stores = new Map<string, QuestionSurfaceStore>()
  readonly #draft = createQuestionDraftStore()
  #sequence = 0
  #disposed = false
  readonly draftStore: DraftHandle

  constructor(private readonly options: QuestionSurfaceRegistryOptions) {
    this.draftStore = { spec: this.#draft.spec, create: scopeKey => {
      if (scopeKey === undefined || scopeKey === '') throw new Error('Question drafts require a Session scope')
      return this.storeFor(scopeKey)
    } }
  }

  storeFor(sessionId: string): QuestionSurfaceStore {
    const existing = this.#stores.get(sessionId)
    if (existing !== undefined) return existing
    if (this.#disposed) throw new Error('Question surface registry is closed')
    const store = this.#draft.create(sessionId)
    this.#stores.set(sessionId, store)
    return store
  }

  record(pending: PendingQuestion): QuestionSurfaceRecord {
    const id = `${pending.sessionId}:${pending.key}`, binding = this.options.bindingOf(pending.sessionId)
    const existing = this.#records.get(id)
    if (existing?.pending === pending && existing.binding === binding && existing.alive) return existing
    if (existing !== undefined) this.#invalidate(existing)
    const record: QuestionSurfaceRecord = {
      id, pending, binding, store: this.storeFor(pending.sessionId), locked: false, error: null,
      version: 0, alive: true, sentVia: 'none', attempt: undefined, listeners: new Set(), offPending: () => {},
    }
    this.#records.set(id, record)
    record.offPending = pending.subscribe(() => {
      if (pending.snapshot().closed || !this.isCurrent(record)) this.#invalidate(record)
      else {
        // A sent waterfall can lose the Host race and become a continued question.
        // Only rearm after the local operation finished; never overlap two sends.
        if (record.attempt === undefined && record.sentVia === 'waterfall' && pending.snapshot().state === 'continued') {
          record.locked = false; record.sentVia = 'none'; record.error = this.options.resubmitMessage()
        }
        this.#notify(record)
      }
    })
    return record
  }

  isCurrent(record: QuestionSurfaceRecord): boolean {
    return !this.#disposed && record.alive && this.#records.get(record.id) === record
      && this.options.isCurrent(record.pending) && !record.pending.snapshot().closed
      && record.binding !== undefined && this.options.bindingOf(record.pending.sessionId) === record.binding
  }

  subscribe(record: QuestionSurfaceRecord, listener: () => void): () => void {
    record.listeners.add(listener)
    return () => { record.listeners.delete(listener) }
  }

  canInteract(record: QuestionSurfaceRecord): boolean { return this.isCurrent(record) && !record.locked }

  beginSettlement(record: QuestionSurfaceRecord): number | undefined {
    if (!this.canInteract(record)) return undefined
    const completion = Promise.withResolvers<void>()
    const id = ++this.#sequence
    record.attempt = { id, channel: 'none', completion: completion.promise, finish: () => { completion.resolve() } }
    record.locked = true; record.error = null
    this.#notify(record)
    return id
  }

  settle(record: QuestionSurfaceRecord, token: number | undefined, send: () => Promise<void>, channel: Channel): Promise<void> {
    const attempt = record.attempt
    if (token === undefined || attempt?.id !== token) return Promise.reject(new Error('Question settlement is not owned by this surface'))
    attempt.channel = channel
    let work: Promise<void>
    try {
      if (!this.isCurrent(record)) throw new Error('This question is no longer current')
      // Invoke the native carrier in this same event turn; no ready-await may
      // change waterfall versus RPC between capture and answer().
      work = this.options.runOperation(record, send)
    } catch (error) { work = Promise.reject(error) }
    return Promise.resolve(work).then(() => {
      if (record.attempt !== attempt) return
      record.sentVia = channel
      if (channel === 'none') record.locked = false
      if (channel === 'waterfall' && record.pending.snapshot().state === 'continued') {
        record.locked = false; record.sentVia = 'none'; record.error = this.options.resubmitMessage()
      }
    }, (error: unknown) => {
      if (record.attempt === attempt && this.isCurrent(record)) {
        record.locked = false; record.sentVia = 'none'
        record.error = error instanceof Error ? error.message : String(error)
      }
      throw error
    }).finally(() => {
      if (record.attempt === attempt) record.attempt = undefined
      attempt.finish(); this.#notify(record)
    })
  }

  clearError(record: QuestionSurfaceRecord): void {
    if (record.error === null || !this.canInteract(record)) return
    record.error = null; this.#notify(record)
  }

  whenSettled(record: QuestionSurfaceRecord): Promise<void> { return record.attempt?.completion ?? Promise.resolve() }

  /** Forget presentation ownership, NOT persisted drafts on ordinary scope release. */
  forget(pending: PendingQuestion): void {
    const id = `${pending.sessionId}:${pending.key}`, record = this.#records.get(id)
    if (record?.pending !== pending) return
    this.#invalidate(record); this.#records.delete(id)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const record of this.#records.values()) this.#invalidate(record)
    this.#records.clear(); this.#stores.clear()
  }

  #invalidate(record: QuestionSurfaceRecord): void {
    if (!record.alive) return
    record.alive = false; record.locked = true; record.offPending(); this.#notify(record)
  }
  #notify(record: QuestionSurfaceRecord): void {
    record.version += 1
    for (const listener of [...record.listeners]) listener()
  }
}

export interface QuestionSurfaceProvider {
  find(sessionId: string): QuestionCardTarget | undefined
  createCard(options: QuestionCardOptions): Promise<QuestionCardHandle>
  /** Compatibility for existing hosts already holding the current carrier. */
  isSupported(pending: unknown): pending is PendingQuestion
  render(pending: unknown, variant?: string): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context { questionSurface: QuestionSurfaceProvider }
}
