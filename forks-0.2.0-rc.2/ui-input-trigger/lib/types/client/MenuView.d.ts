import { type ReactElement } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { MenuViewInjected } from './slots.ts';
/** Full menu props: injected face + the locale seat. */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'> & {
    readonly idPrefix?: string;
    readonly inline?: boolean;
};
/**
 * Render the candidate menu overlay entry.
 * @param props - injected face (the menu store and the pick route); `t` rides the standard locale seat.
 * @returns the dropdown while open; null while closed.
 */
export declare function MenuView({ menu, headers, onPick, onCrumb, onHover, onDismiss, t, idPrefix, inline }: MenuViewProps): ReactElement | null;
