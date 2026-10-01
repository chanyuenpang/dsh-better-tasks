import { type ReactNode } from 'react';
import type { PendingQuestion, PlanReview, QuestionComposerProps } from './contract/slots.ts';
import type { QuestionSurfaceGate } from './question-surface.ts';
/** The panel's own props: the question domain face, the narrowed review, the settlement gate, and the locale seat. */
export type PlanReviewPanelProps = {
    pending: PendingQuestion;
    review: PlanReview;
    gate: QuestionSurfaceGate;
} & Pick<QuestionComposerProps, 't' | 'renderSlot'>;
/**
 * Render plan review controls; the submitted document opens in the sidebar.
 *
 * @param props - the question domain face, the narrowed plan review, and `t`.
 * @returns The plan-review takeover for this request.
 */
export declare function PlanReviewPanel({ pending, review, t, renderSlot, gate }: PlanReviewPanelProps): ReactNode;
