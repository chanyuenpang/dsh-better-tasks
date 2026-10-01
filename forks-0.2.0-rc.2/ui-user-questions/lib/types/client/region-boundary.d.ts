/**
 * Contain one region's render failure at this package's own registration.
 *
 * The framework's `SlotErrorBoundary` wraps the whole occupancy, so any throw in a
 * region retired that entry and blanked the area. This boundary sits directly
 * around the component this package registers, records the failure — including
 * `info.componentStack`, which names the offending descendant — and renders a
 * compact fallback instead of rethrowing, so the rest of the shell stays usable
 * while the real adaptation is written.
 */
import { type ComponentType } from 'react';
export declare function withRegionBoundary(region: string, Inner: ComponentType<any>): ComponentType<any>;
