/**
 * Project appearance: the per-Workspace icon and colour Better Tasks shows on
 * Session rows, and the picker that writes them.
 *
 * The Host owns the data (`/api/project-appearance`, backed by the
 * `workspace_appearance` storage domain) and publishes the full icon catalog with
 * every GET, so the client keeps no catalog of its own: it renders whatever the
 * Host sends and falls back to a small built-in set until the first load lands.
 */
import { type ReactNode } from 'react';
/** One stored appearance as the Host reports it. */
export interface ProjectAppearance {
    workspaceId: string;
    iconKey: string;
    colorKey: string;
    updatedAt?: string;
}
/** The swatch palette; every `COLOR_KEYS` entry the Host accepts has a value here. */
export declare const PROJECT_APPEARANCE_COLORS: Readonly<Record<string, string>>;
/**
 * One row's project icon: the Host catalog glyph when known, otherwise a built-in
 * fallback, always tinted with the appearance's colour.
 * @param props.appearance - the Workspace's stored appearance.
 * @returns the icon element, sized for a Session row.
 */
export declare function ProjectAppearanceIcon({ appearance }: {
    appearance: ProjectAppearance;
}): ReactNode;
/**
 * Fetch the Host's project appearances and keep them live.
 *
 * Reloads on the `project-appearance-changed` window event, which the picker
 * dispatches after a successful save, so every mounted row repaints without a
 * reload and without a second polling channel.
 * @returns Workspace id to appearance; empty until the first load resolves.
 */
export declare function useProjectAppearances(): ReadonlyMap<string, ProjectAppearance>;
/** Copy the picker needs; the browser passes its own translator. */
type AppearanceTranslate = (key: string) => string;
/**
 * Open the modal icon/colour picker for one Workspace.
 *
 * Imperative DOM rather than a React portal: the picker is a single native
 * `<dialog>` with no interaction with the React tree, and this keeps it usable
 * from a menu callback without threading state through the row components.
 * @param workspaceId - Workspace to edit.
 * @param t - translator bound to this package's namespace.
 */
export declare function openProjectAppearancePicker(workspaceId: string, t: AppearanceTranslate): Promise<void>;
export {};
