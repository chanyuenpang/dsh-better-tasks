import { type ReactNode } from 'react';
import { type QuestionComposerProps } from './contract/slots.ts';
import type { PendingQuestion } from './contract/slots.ts';
import type { QuestionSurfaceRegistry, QuestionSurfaceStore } from './question-surface.ts';
/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export declare function parseRecommendedLabel(label: string): {
    label: string;
    recommended: boolean;
};
/**
 * Composer takeover router. Generic-question drafts live in this entry's
 * Session-scoped Slot store, keyed by the pending carrier, so a strict Session
 * entry remount restores the same request without exposing it to another one.
 *
 * One takeover, two presentations: a request that declares a presentation intent this
 * package renders uses that presentation (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither presentation can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
export declare function QuestionComposer(props: QuestionComposerProps & {
    registry: QuestionSurfaceRegistry;
}): ReactNode;
/**
 * The settlement gate shared by every surface of one pending request. A surface
 * asks `beginSettlement` before it sends; the first caller owns the decision and
 * every other surface re-renders with `locked` and the last failure message.
 */
export type { QuestionSurfaceGate } from './question-surface.ts';
/**
 * The standard-kit subset both presentations read. The composer seat supplies
 * the framework bindings; a host-mounted surface supplies bindings over the
 * registry's Session-shared draft store and `renderSlot: () => null`, because a
 * renderSlot binding is only authorizable inside the entry that declares it
 * (ui-slots raises SlotOwnershipError / StaleAuthorizationError otherwise).
 */
type QuestionSurfaceKit = Pick<QuestionComposerProps, 't' | 'useQuestionCard' | 'renderSlot'> & {
    /**
     * A host-mounted surface binds the SAME Session instance that the composer
     * Slot resolves; the component turns that engine source into the
     * `useStore`/`actions` pair the presentations read. Exactly one of `store`
     * and the `useStore`/`actions` pair is supplied.
     */
    store?: QuestionSurfaceStore;
    useStore?: QuestionComposerProps['useStore'];
    actions?: QuestionComposerProps['actions'];
};
/**
 * One shared surface implementation for every seat a pending question appears
 * in. It resolves the request's registry record, subscribes to the record's
 * revision, and publishes the surface discriminator as `data-question-surface`
 * so a host can target it without reaching into this package's CSS modules.
 *
 * @param props - the carrier, its registry, the surface discriminator, and the standard kit.
 * @returns The question flow, or the intent's own presentation, for this request.
 */
export declare function QuestionSurface({ pending, registry, variant, store, isAvailable, useStore: seatUseStore, actions: seatActions, ...kit }: QuestionSurfaceKit & {
    pending: PendingQuestion;
    registry: QuestionSurfaceRegistry;
    variant: string;
    isAvailable?: () => boolean;
}): ReactNode;
