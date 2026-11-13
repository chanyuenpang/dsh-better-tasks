/**
 * Project appearance: the per-Workspace icon and colour Better Tasks shows on
 * Session rows, and the picker that writes them.
 *
 * The Host owns the data (`/api/project-appearance`, backed by the
 * `workspace_appearance` storage domain) and publishes the full icon catalog with
 * every GET, so the client keeps no catalog of its own: it renders whatever the
 * Host sends and falls back to a small built-in set until the first load lands.
 */
import { useEffect, useState, type ReactNode } from 'react'

/** One stored appearance as the Host reports it. */
export interface ProjectAppearance {
  workspaceId: string
  iconKey: string
  colorKey: string
  updatedAt?: string
}

/** One catalog icon: a Tabler glyph as `[tag, props]` node pairs. */
interface CatalogIcon {
  key: string
  label: string
  category?: string
  nodes: [string, Record<string, unknown>][]
}

/** The swatch palette; every `COLOR_KEYS` entry the Host accepts has a value here. */
export const PROJECT_APPEARANCE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  blue: '#3b82f6',
  cyan: '#06b6d4',
  green: '#22c55e',
  orange: '#f97316',
  pink: '#ec4899',
  purple: '#8b5cf6',
  red: '#ef4444',
  yellow: '#eab308',
  teal: '#14b8a6',
  indigo: '#6366f1',
  amber: '#f59e0b',
  slate: '#64748b',
  black: '#111827',
})

/** Colour for an appearance; an unknown key falls back to the first palette entry. */
function colorOf(colorKey: string): string {
  return PROJECT_APPEARANCE_COLORS[colorKey] ?? PROJECT_APPEARANCE_COLORS.blue
}

/**
 * The last catalog the Host sent, keyed by icon key. Module-level because the
 * glyph lookup happens while rendering rows far from the fetch that filled it.
 */
const projectIconCatalog = new Map<string, CatalogIcon>()

/* Fallback glyphs, drawn only until the Host catalog arrives. A fixed 20x20 grid
   so a row's icon slot never reflows when the catalog replaces them. */
const FALLBACK_ICON_PATHS: Readonly<Record<string, string>> = Object.freeze({
  briefcase: 'M5 7h10v8H5z M7 7V5h6v2 M5 10h10',
  code: 'M7 6 3 10l4 4 M13 6l4 4-4 4',
  database: 'M4 6c0-2 8-2 8 0s-8 2-8 0m0 0v8c0 2 8 2 8 0V6m-8 4c0 2 8 2 8 0',
  flask: 'M8 3v5l-4 7h8l-4-7V3 M6 12h4',
  folder: 'M3 6h5l1 2h6v7H3z',
  globe: 'M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14m-7 7h14M10 3c2 2 2 12 0 14m0-14c-2 2-2 12 0 14',
  layers: 'm4 7 6-3 6 3-6 3z m-6 3 6 3 6-3 m-6 3 6 3 6-3',
  palette: 'M10 3a7 7 0 1 0 0 14h1a2 2 0 0 0 0-4h-1a1 1 0 0 1 0-2a8 8 0 0 0 4-8 M6 8h.01M9 6h.01M13 8h.01',
  rocket: 'M12 3c3 1 4 4 4 7l-5 5-4-4 5-5c3 0 6 1 7 4 M7 12l-3 1 3 2m5-5 1-3 2 3',
  shield: 'M10 3 16 5v4c0 4-3 6-6 8-3-2-6-4-6-8V5z',
  sparkles: 'm10 3 .8 3.2L14 7l-3.2.8L10 11l-.8-3.2L6 7l3.2-.8z M4 13l.4 1.6L6 15l-1.6.4L4 17l-.4-1.6L2 15l1.6-.4z',
  terminal: 'M4 5h12v10H4z M6 8l2 2-2 2m4 0h3',
})

/**
 * One row's project icon: the Host catalog glyph when known, otherwise a built-in
 * fallback, always tinted with the appearance's colour.
 * @param props.appearance - the Workspace's stored appearance.
 * @returns the icon element, sized for a Session row.
 */
export function ProjectAppearanceIcon({ appearance }: { appearance: ProjectAppearance }): ReactNode {
  const color = colorOf(appearance.colorKey)
  const catalogIcon = projectIconCatalog.get(appearance.iconKey)
  const frame = {
    display: 'inline-flex', flex: '0 0 auto', width: 16, height: 16, marginRight: 6, color,
  } as const

  if (catalogIcon !== undefined) {
    return (
      <span style={frame} aria-label={`Project icon: ${appearance.iconKey}`} role="img">
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {catalogIcon.nodes.map(([tag, attrs], index) => {
            // The catalog carries a `key` attribute per node; React needs its own.
            const { key: _ignored, ...rest } = attrs as Record<string, unknown> & { key?: unknown }
            const Node = tag as 'path'
            return <Node key={index} {...rest} />
          })}
        </svg>
      </span>
    )
  }

  return (
    <span style={frame} aria-label={`Project icon: ${appearance.iconKey}`} role="img">
      <svg
        viewBox="0 0 20 20"
        width={16}
        height={16}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={FALLBACK_ICON_PATHS[appearance.iconKey] ?? FALLBACK_ICON_PATHS.folder} />
      </svg>
    </span>
  )
}

/**
 * Fetch the Host's project appearances and keep them live.
 *
 * Reloads on the `project-appearance-changed` window event, which the picker
 * dispatches after a successful save, so every mounted row repaints without a
 * reload and without a second polling channel.
 * @returns Workspace id to appearance; empty until the first load resolves.
 */
export function useProjectAppearances(): ReadonlyMap<string, ProjectAppearance> {
  const [appearances, setAppearances] = useState<ReadonlyMap<string, ProjectAppearance>>(new Map())
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetch('/api/project-appearance', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .then((data: { items?: ProjectAppearance[], icons?: CatalogIcon[] } | null) => {
          if (!alive || data === null) return
          projectIconCatalog.clear()
          for (const icon of data.icons ?? []) projectIconCatalog.set(icon.key, icon)
          setAppearances(new Map((data.items ?? []).map(item => [item.workspaceId, item])))
        })
        .catch(() => {})
    }
    load()
    window.addEventListener('project-appearance-changed', load)
    return () => {
      alive = false
      window.removeEventListener('project-appearance-changed', load)
    }
  }, [])
  return appearances
}

/** Copy the picker needs; the browser passes its own translator. */
type AppearanceTranslate = (key: string) => string

/**
 * Open the modal icon/colour picker for one Workspace.
 *
 * Imperative DOM rather than a React portal: the picker is a single native
 * `<dialog>` with no interaction with the React tree, and this keeps it usable
 * from a menu callback without threading state through the row components.
 * @param workspaceId - Workspace to edit.
 * @param t - translator bound to this package's namespace.
 */
export async function openProjectAppearancePicker(
  workspaceId: string,
  t: AppearanceTranslate,
): Promise<void> {
  const data = await fetch('/api/project-appearance', { cache: 'no-store' })
    .then(response => (response.ok ? response.json() : Promise.reject(new Error('load failed'))))
  const items = (data.items ?? []) as ProjectAppearance[]
  const icons = (data.icons ?? []) as CatalogIcon[]
  const current = items.find(item => item.workspaceId === workspaceId)
  let iconKey = current?.iconKey ?? 'folder'
  let colorKey = current?.colorKey ?? 'black'

  const dialog = document.createElement('dialog')
  dialog.style.cssText = 'width:min(680px,92vw);border:0;border-radius:12px;padding:20px;'
    + 'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)'
  const title = document.createElement('h3')
  title.textContent = t('appearance.pickerTitle')
  dialog.append(title)

  const search = document.createElement('input')
  search.placeholder = t('appearance.search')
  search.style.cssText = 'width:100%;box-sizing:border-box;margin:8px 0;padding:8px'
  dialog.append(search)

  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:6px;max-height:448px;overflow:auto'
  dialog.append(grid)

  const swatches = document.createElement('div')
  swatches.style.cssText = 'display:flex;gap:8px;margin:14px 0;flex-wrap:wrap'
  dialog.append(swatches)

  for (const [key, color] of Object.entries(PROJECT_APPEARANCE_COLORS)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = key
    button.style.cssText = `width:24px;height:24px;border-radius:50%;background:${color};`
      + `border:${key === colorKey ? '3px solid white' : '1px solid transparent'}`
    button.onclick = () => {
      colorKey = key
      for (const child of swatches.children) (child as HTMLElement).style.outline = ''
      button.style.outline = '2px solid currentColor'
      render()
    }
    swatches.append(button)
  }

  const render = (): void => {
    const query = search.value.toLowerCase()
    const cells = icons
      .filter(icon => icon.label.includes(query))
      .slice(0, 240)
      .map((icon) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.title = icon.label
        button.setAttribute('aria-label', icon.label)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('width', '22')
        svg.setAttribute('height', '22')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '2')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')
        for (const [tag, props] of icon.nodes) {
          const child = document.createElementNS('http://www.w3.org/2000/svg', tag)
          for (const [name, value] of Object.entries(props)) child.setAttribute(name, String(value))
          svg.append(child)
        }
        button.append(svg)
        button.style.cssText = 'display:grid;place-items:center;aspect-ratio:1;padding:4.5px;border-radius:6px;'
          + `border:${icon.key === iconKey ? '2px solid #6366f1' : '1px solid color-mix(in srgb,currentColor 22%,transparent)'};`
          + `background:${icon.key === iconKey ? 'color-mix(in srgb,#6366f1 16%,transparent)' : 'transparent'};`
          + `color:${colorOf(colorKey)};cursor:pointer`
        button.onclick = () => {
          iconKey = icon.key
          render()
        }
        return button
      })
    grid.replaceChildren(...cells)
  }
  search.oninput = render
  render()

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px'
  const cancel = document.createElement('button')
  cancel.textContent = t('appearance.cancel')
  cancel.onclick = () => { dialog.close() }
  const save = document.createElement('button')
  save.textContent = t('appearance.save')
  save.onclick = () => {
    void (async () => {
      const response = await fetch('/api/project-appearance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, iconKey, colorKey }),
      })
      if (!response.ok) {
        window.alert(t('appearance.saveFailed'))
        return
      }
      window.dispatchEvent(new Event('project-appearance-changed'))
      dialog.close()
    })()
  }
  footer.append(cancel, save)
  dialog.append(footer)
  dialog.addEventListener('close', () => { dialog.remove() })
  document.body.append(dialog)
  dialog.showModal()
}
