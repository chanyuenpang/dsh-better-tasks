import type { ComponentType } from 'react';
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { DraftAttachmentId, InputNotice, InputState, SessionInput, SubmitOutcome } from './input.ts';
import type { InputSubmitMode } from './composer-submission.ts';
/** Ordinary-message interception only; command adjudication has already finished. */
export interface ComposerSurfaceSinkArgs {
    readonly binding: SessionBinding;
    readonly text: string;
    readonly attachmentIds: readonly DraftAttachmentId[];
    readonly mode: InputSubmitMode;
    readonly signal: AbortSignal;
}
export interface ComposerSurfaceOptions {
    readonly sessionId: SessionId;
    readonly initialDraft?: string;
    readonly signal?: AbortSignal;
    readonly defaultSink?: (args: ComposerSurfaceSinkArgs) => Promise<SubmitOutcome>;
}
/** The caller supplies copy; empty-draft Continue is optional and never overwrites a draft. */
export interface ComposerSurfaceViewProps {
    readonly placeholder?: string;
    readonly defaultText?: string;
    readonly onDraftChange?: (text: string) => void;
    readonly submitLabel?: string;
    readonly addLabel?: string;
    readonly searchLabel?: string;
    readonly emptyLabel?: string;
    readonly errorLabel?: string;
    readonly inputLabel?: string;
    readonly disabled?: boolean;
    readonly className?: string;
}
export interface ComposerSurfaceHandle {
    readonly sessionId: SessionId;
    readonly input: SessionInput;
    readonly state: ObservableSnapshot<InputState>;
    readonly notices: ObservableSnapshot<InputNotice | null>;
    /** Bound view: consumers render this component without importing another Client package. */
    readonly View: ComponentType<ComposerSurfaceViewProps>;
    /** Resolves after closing AND every admitted business operation settles. */
    readonly closed: Promise<void>;
    whenSettled(): Promise<void>;
    dispose(): void;
}
