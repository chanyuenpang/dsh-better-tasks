import type { Context } from '@deepseek-ai/cordis';
import { type ComponentType } from 'react';
import { type ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { ComposerSurfaceHandle, ComposerSurfaceOptions } from '../contract/input-surface.ts';
import type { InputTriggerController } from '../contract/input.ts';
import { SessionInputShell } from './facade.ts';
/** Views travel through services, never runtime imports of another Client plugin. */
export interface SurfaceTrigger extends InputTriggerController {
    readonly View: ComponentType<any>;
    readonly menu: ObservableSnapshot<{
        readonly open: boolean;
        readonly highlight?: {
            source: string;
            index: number;
        } | null;
        readonly groups: readonly {
            status: string;
            failed?: boolean;
            items: readonly unknown[];
        }[];
    }>;
    toggleAll(hit: Parameters<InputTriggerController['toggleSource']>[1]): void;
    filterLauncher(query: string): void;
    readonly headers: ObservableSnapshot<unknown>;
    pick(source: string, index: number, action?: 'pick' | 'drill'): void;
    pickCrumb(source: string, index: number): void;
    hover(source: string, index: number): void;
    dismiss(): void;
    dispose(): void;
}
export interface SurfaceCommand {
    readonly popup: {
        readonly state?: ObservableSnapshot<{
            open: boolean;
        }>;
        dismiss(options?: {
            focusComposer?: boolean;
        }): void;
    };
    readonly View: ComponentType<any>;
    dispose(): void;
}
export interface SurfaceViewModel {
    readonly shell: SessionInputShell;
    readonly trigger: SurfaceTrigger;
    readonly command: SurfaceCommand;
    readonly id: string;
    readonly gate: ObservableSnapshot<{
        disabled: boolean;
        running: boolean;
        reason?: string;
    }>;
    readonly menuTranslate: (...args: any[]) => string;
    readonly commandTranslate: (...args: any[]) => string;
    readonly translate: (...args: any[]) => string;
    submit(defaultText?: string, mode?: 'queue' | 'steer', source?: 'click' | 'enter'): void;
    canInteract(): boolean;
    setDisabled(disabled: boolean): void;
    launchMenu(source?: string): void;
    filterMenu(query: string): void;
}
/** Create an independently owned editor over one exact, retained Session generation. */
export declare function createInputSurface(root: Context, options: ComposerSurfaceOptions): Promise<ComposerSurfaceHandle>;
