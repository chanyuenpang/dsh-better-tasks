/** Shared Session-scoped drafts and single-flight settlement for native and card seats. */
import { createQuestionDraftStore } from './draft-store.ts';
import type { PendingQuestion, QuestionCardSnapshot } from './contract/slots.ts';
import type { QuestionCardHandle, QuestionCardOptions, QuestionCardTarget } from './surface-card.tsx';
type DraftHandle = ReturnType<typeof createQuestionDraftStore>;
export type QuestionSurfaceStore = ReturnType<DraftHandle['create']>;
type Channel = QuestionCardSnapshot['channel'];
interface Attempt {
    readonly id: number;
    channel: Channel;
    readonly completion: Promise<void>;
    readonly finish: () => void;
}
export interface QuestionSurfaceRecord {
    readonly id: string;
    readonly pending: PendingQuestion;
    readonly binding: unknown;
    readonly store: QuestionSurfaceStore;
    locked: boolean;
    error: string | null;
    version: number;
    alive: boolean;
    sentVia: Channel;
    attempt: Attempt | undefined;
    readonly listeners: Set<() => void>;
    offPending: () => void;
}
export interface QuestionSurfaceGate {
    readonly locked: boolean;
    readonly error: string | null;
    beginSettlement(): boolean;
    settle(send: () => Promise<void>, channel?: Channel): Promise<void>;
    canInteract(): boolean;
    clearError(): void;
}
export interface QuestionSurfaceRegistryOptions {
    isCurrent(pending: PendingQuestion): boolean;
    bindingOf(sessionId: string): unknown;
    runOperation(record: QuestionSurfaceRecord, send: () => Promise<void>): Promise<void>;
    resubmitMessage(): string;
}
/** One store instance per resolved persistence key; card and Slot share the actual object. */
export declare class QuestionSurfaceRegistry {
    #private;
    private readonly options;
    readonly draftStore: DraftHandle;
    constructor(options: QuestionSurfaceRegistryOptions);
    storeFor(sessionId: string): QuestionSurfaceStore;
    record(pending: PendingQuestion): QuestionSurfaceRecord;
    isCurrent(record: QuestionSurfaceRecord): boolean;
    subscribe(record: QuestionSurfaceRecord, listener: () => void): () => void;
    canInteract(record: QuestionSurfaceRecord): boolean;
    beginSettlement(record: QuestionSurfaceRecord): number | undefined;
    settle(record: QuestionSurfaceRecord, token: number | undefined, send: () => Promise<void>, channel: Channel): Promise<void>;
    clearError(record: QuestionSurfaceRecord): void;
    whenSettled(record: QuestionSurfaceRecord): Promise<void>;
    /** Forget presentation ownership, NOT persisted drafts on ordinary scope release. */
    forget(pending: PendingQuestion): void;
    dispose(): void;
}
export interface QuestionSurfaceProvider {
    find(sessionId: string): QuestionCardTarget | undefined;
    createCard(options: QuestionCardOptions): Promise<QuestionCardHandle>;
    /** Compatibility for existing hosts already holding the current carrier. */
    isSupported(pending: unknown): pending is PendingQuestion;
    render(pending: unknown, variant?: string): unknown;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        questionSurface: QuestionSurfaceProvider;
    }
}
export {};
