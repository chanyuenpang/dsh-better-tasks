/**
 * Activity-range filtering for the workspace browser: the `all / 1d / 3d / 7d / 14d`
 * window the view-options menu selects.
 *
 * Better Tasks adds this filter on top of upstream's grouping and ordering. It is a
 * pure predicate over one Session summary so it can be applied to the grouped tree,
 * the flat list amd the search results through the same rule.
 */
/** Selectable activity windows, in menu order; `null` days means "no bound". */
export declare const ACTIVITY_RANGE_DAYS: Readonly<{
    all: null;
    '1d': 1;
    '3d': 3;
    '7d': 7;
    '14d': 14;
}>;
/** One activity window id. */
export type ActivityRange = keyof typeof ACTIVITY_RANGE_DAYS;
/** Menu order of the activity windows. */
export declare const ACTIVITY_RANGE_ORDER: readonly ActivityRange[];
/** Milliseconds in one day; the predicate's only time unit. */
export declare const ACTIVITY_DAY_MS = 86400000;
/** The Session fields the predicate reads; a structural subset of the Session summary. */
export interface ActivityRangeSession {
    readonly blank?: boolean;
    readonly updatedAt?: number;
}
/**
 * Whether a Session belongs to the selected activity window.
 * @param session - Session summary; an unknown Session never matches a bounded window.
 * @param activityRange - selected window.
 * @param now - reference instant, read once per render so every row agrees.
 * @returns true when the Session is inside the window; blank Sessions always are.
 */
export declare function sessionInActivityRange(session: ActivityRangeSession | undefined, activityRange: ActivityRange, now: number): boolean;
/**
 * Narrow one Session-id list to the selected window. Keeps the input order.
 * @param ids - candidate Session ids.
 * @param byId - Session summaries by id.
 * @param activityRange - selected window.
 * @param now - reference instant.
 * @returns the ids inside the window.
 */
export declare function filterSessionIdsByActivityRange(ids: readonly string[], byId: Readonly<Record<string, ActivityRangeSession | undefined>>, activityRange: ActivityRange, now: number): string[];
