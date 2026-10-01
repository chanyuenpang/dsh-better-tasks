import { type ComponentType } from 'react';
import { type ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { Context } from '@deepseek-ai/cordis';
import type { InboxWireState } from '@deepseek-ai/dsh-agent/types';
import { PendingQuestion, type QuestionComposerProps } from './contract/slots.ts';
import type { QuestionSurfaceRecord, QuestionSurfaceRegistry } from './question-surface.ts';
export interface QuestionCardTarget {
    readonly sessionId: string;
    readonly requestKey: string;
    readonly callId?: string;
    readonly kind: 'question' | 'plan-review';
}
export interface QuestionCardOptions {
    readonly sessionId: string;
    readonly requestKey?: string;
    readonly callId?: string;
    readonly signal?: AbortSignal;
}
export interface QuestionCardViewProps {
    readonly fontSize?: number;
    readonly className?: string;
}
export interface QuestionCardState {
    readonly phase: 'waiting' | 'ready' | 'closed' | 'unsupported' | 'error';
    readonly kind?: 'question' | 'plan-review';
    readonly message?: string;
}
export interface QuestionCardHandle {
    readonly sessionId: string;
    readonly requestKey: string;
    readonly callId?: string;
    readonly state: ObservableSnapshot<QuestionCardState>;
    readonly View: ComponentType<QuestionCardViewProps>;
    readonly closed: Promise<void>;
    dispose(): void;
}
export interface QuestionCardsAccess {
    source(key: string): PendingQuestion | undefined;
    values(): readonly {
        readonly pending: PendingQuestion;
    }[];
    subscribe(key: string, listener: () => void): () => void;
}
/** Same durable Inbox exclusion as the native continued-question reconciler. */
export declare function queuedQuestionReplies(inbox: InboxWireState | undefined): ReadonlySet<string>;
/** Discover existing data only. The caller's existing list/status hooks drive refresh. */
export declare function findQuestionCard(ctx: Context, cards: QuestionCardsAccess, sessionId: string): QuestionCardTarget | undefined;
/** Bind the real PendingQuestion observable, rather than pretending source(key) is a React hook. */
export declare function createQuestionCardHook(pending: PendingQuestion): QuestionComposerProps['useQuestionCard'];
/** Retain one exact Session generation and one exact request; never navigate or reveal a native seat. */
export declare function createQuestionCard(ctx: Context, cards: QuestionCardsAccess, registry: QuestionSurfaceRegistry, reconcile: () => void, options: QuestionCardOptions, t: QuestionComposerProps['t']): Promise<QuestionCardHandle>;
/** A settlement lease is separate from its view's abort signal and starts synchronously. */
export declare function runQuestionOperation(ctx: Context, record: QuestionSurfaceRecord, send: () => Promise<void>): Promise<void>;
