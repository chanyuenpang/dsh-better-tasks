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
import { Component, createElement, type ComponentType, type ReactNode } from 'react'

/** Stamped at build time by scripts/build-forks-from-source.mjs. */
const BUILD_REVISION = '__BUILD_REVISION__'

export function withRegionBoundary(
  region: string,
  Inner: ComponentType<any>,
): ComponentType<any> {
  return class RegionBoundary extends Component<Record<string, unknown>, { failed: boolean }> {
    override state: { failed: boolean } = { failed: false }

    static getDerivedStateFromError(): { failed: boolean } {
      return { failed: true }
    }

    override componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
      try {
        localStorage.setItem(`dbt-region-error:${region}`, JSON.stringify({
          revision: BUILD_REVISION,
          region,
          message: String((error as Error | undefined)?.message ?? error),
          stack: String((error as Error | undefined)?.stack ?? '').slice(0, 2000),
          componentStack: String(info?.componentStack ?? '').slice(0, 2000),
        }))
      } catch {}
    }

    override render(): ReactNode {
      if (this.state.failed) {
        return createElement('div', {
          style: { padding: '8px', font: '11px ui-monospace, monospace', color: '#ff9f9f' },
        }, `${region}: render failed`)
      }
      return createElement(Inner, this.props)
    }
  }
}
