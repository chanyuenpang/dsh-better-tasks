import { type ReactNode } from 'react';
import type { ComposerSurfaceViewProps } from '../contract/input-surface.ts';
import type { SurfaceViewModel } from './surface.ts';
/** Original compact card face over the independent native editor and command pipeline. */
export declare function InputSurfaceView({ surface, placeholder, defaultText, onDraftChange, submitLabel, addLabel, searchLabel, emptyLabel, errorLabel, inputLabel, disabled, className }: ComposerSurfaceViewProps & {
    surface: SurfaceViewModel;
}): ReactNode;
