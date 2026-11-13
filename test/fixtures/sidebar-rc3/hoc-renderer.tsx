/** Props of one hoc layer Component: the owner share and the content it wraps. */
interface HocLayerProps {
  owner: object
  children: ReactNode
}

/** Render the content inside one hoc layer: the next inner layer, or the owner's content itself at the innermost layer. */
type RenderHocInner = (owner: object, children: ReactNode) => ReactNode

/** The innermost step: the owner's content unchanged, with no Component of its own. */
const renderHocContent: RenderHocInner = (_owner, children) => children

/**
 * Build one hoc layer Component. Scope, entry, and crash reporting are fixed
 * here; a render passes only the owner share and the next inner layer. A
 * crashed layer renders that inner content for the rest of that occurrence's
 * mount and stays registered, so other occurrences keep it.
 * @param host - registry host owning the ledger.
 * @param slotKey - the hoc slot.
 * @param spec - its live declaration.
 * @param entry - the layer's registration.
 * @param renderInner - renders the content inside this layer.
 * @returns the layer Component.
 */
function hocLayer(
  host: SlotRendererHost,
  slotKey: string,
  spec: SlotSpec<SlotEntryDef>,
  entry: StoredEntry,
  renderInner: RenderHocInner,
): FC<HocLayerProps> {
  const anchor: SlotAnchorTag = spec.inline === true ? 'span' : 'div'
  const slotInjected = cachedSlotInject(spec.inject)
  // A layer's failure belongs to the occurrence it rendered; retiring it would strip every other occurrence too.
  const onEntryError = (error: unknown): void => {
    host.reportEntryError(slotKey, entry, error, { abdicate: false })
  }
  let Layer: FC<HocLayerProps>
  switch (spec.scope) {
    case 'session':
      Layer = ({ owner, children }) => {
        const inner = <HocContentBoundary>{renderInner(owner, children)}</HocContentBoundary>
        return (
          <StrictSessionEntry
            slotKey={slotKey} anchor={anchor} crashed={inner} onEntryError={onEntryError}
            entry={entry} ownerProps={owner} slotInjected={slotInjected} hookContext={undefined} hasHookContext={false}
          >
            {inner}
          </StrictSessionEntry>
        )
      }
      break
    case 'session-maybe':
      Layer = ({ owner, children }) => {
        const inner = <HocContentBoundary>{renderInner(owner, children)}</HocContentBoundary>
        return (
          <SlotErrorBoundary slotKey={slotKey} anchor={anchor} crashed={inner} onEntryError={onEntryError}>
            <SessionMaybeEntry
              entry={entry} ownerProps={owner} slotKey={slotKey} slotInjected={slotInjected} hookContext={undefined} hasHookContext={false}
            >
              {inner}
            </SessionMaybeEntry>
          </SlotErrorBoundary>
        )
      }
      break
    case 'root':
      Layer = ({ owner, children }) => {
        const inner = <HocContentBoundary>{renderInner(owner, children)}</HocContentBoundary>
        return (
          <SlotErrorBoundary slotKey={slotKey} anchor={anchor} crashed={inner} onEntryError={onEntryError}>
            <RootEntry
              entry={entry} ownerProps={owner} slotKey={slotKey} slotInjected={slotInjected} hookContext={undefined} hasHookContext={false}
            >
              {inner}
            </RootEntry>
          </SlotErrorBoundary>
        )
      }
      break
  }
  return Layer
}

/**
 * The layers one dispatch applies: wildcard layers plus layers registered for
 * `entryKey`, an exact-key layer replacing the wildcard layer with its id.
 * Winners arrive in ledger order (priority first), so the stable sort by
 * `order` keeps priority, then registration order, within equal orders.
 * @param winners - the slot's shadowing winners.
 * @param entryKey - the dispatch key, or undefined for wildcard-only dispatch.
 * @returns the layers, lowest `order` (outermost) first.
 */
function hocLayersFor(winners: readonly StoredEntry[], entryKey: string | undefined): readonly StoredEntry[] {
  const exactIds = new Set<string | undefined>()
  if (entryKey !== undefined) {
    for (const entry of winners) if (entry.options.key === entryKey) exactIds.add(entry.options.id)
  }
  return winners
    .filter(entry => entry.options.key === undefined ? !exactIds.has(entry.options.id) : entry.options.key === entryKey)
    .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
}

/**
 * Nest the given layers into one render function, first layer outermost.
 * Each layer adds exactly one Component; with no layer the result renders the
 * owner's content directly.
 * @param host - registry host owning the ledger.
 * @param slotKey - the hoc slot.
 * @param spec - its live declaration.
 * @param layers - the dispatch's layers, outermost first.
 * @returns the composed render function; its layer Components are the layer set's identity.
 */
function composeHocLayers(
  host: SlotRendererHost,
  slotKey: string,
  spec: SlotSpec<SlotEntryDef>,
  layers: readonly StoredEntry[],
): RenderHocInner {
  return layers.reduceRight<RenderHocInner>((renderInner, entry) => {
    const Layer = hocLayer(host, slotKey, spec, entry, renderInner)
    return (owner, children) => <Layer owner={owner}>{children}</Layer>
  }, renderHocContent)
}

/** One compiled layer chain for one dispatch key of one hoc declaration. */
interface CompiledHoc {
  /** Ledger version this chain was last validated against. */
  version: number
  /** The ordered layers the chain was composed from, compared by identity. */
  readonly layers: readonly StoredEntry[]
  /** The composed render function. */
  readonly render: RenderHocInner
}

/**
 * Compiled hoc chains per host, live declaration, and dispatch key. Every
 * outlet dispatching the same key shares one chain, so its layer Components,
 * the remount boundary of the content inside them, are created once; a
 * redeclared slot gets a new spec object and therefore an empty cache.
 */
const hocChains = new WeakMap<SlotRendererHost, WeakMap<SlotSpec<SlotEntryDef>, Map<string, CompiledHoc>>>()

/**
 * Whether two layer lists hold the same entries in the same order.
 * @param a - one list.
 * @param b - the other list.
 * @returns whether they are element-wise identical.
 */
function sameLayers(a: readonly StoredEntry[], b: readonly StoredEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index])
}

/**
 * The shared layer chain for one dispatch key: revalidated once per ledger
 * version and recomposed only when this key's ordered layers change, so a
 * registration for another key never remounts this key's content.
 * @param host - registry host owning the ledger.
 * @param slotKey - the hoc slot.
 * @param spec - its live declaration.
 * @param entryKey - the dispatch key, or undefined for wildcard-only dispatch.
 * @returns the chain's render function.
 */
function hocChainFor(
  host: SlotRendererHost,
  slotKey: string,
  spec: SlotSpec<SlotEntryDef>,
  entryKey: string | undefined,
): RenderHocInner {
  let bySpec = hocChains.get(host)
  if (bySpec === undefined) {
    bySpec = new WeakMap()
    hocChains.set(host, bySpec)
  }
  let chains = bySpec.get(spec)
  if (chains === undefined) {
    chains = new Map()
    bySpec.set(spec, chains)
  }
  // Key dispatches carry a prefix so none shares the wildcard dispatch's entry.
  const cacheKey = entryKey === undefined ? '' : `=${entryKey}`
  const version = host.getVersion(slotKey)
  const cached = chains.get(cacheKey)
  if (cached !== undefined && cached.version === version) return cached.render
  const layers = hocLayersFor(host.entriesOfSlot(slotKey), entryKey)
  if (cached !== undefined && sameLayers(cached.layers, layers)) {
    cached.version = version
    return cached.render
  }
  const render = layers.length === 0 ? renderHocContent : composeHocLayers(host, slotKey, spec, layers)
  chains.set(cacheKey, { version, layers, render })
  return render
}

/** Hoc dispatch over the shared per-key chain; the enclosing outlet re-renders on every ledger version. */
function HocOutlet({ slotKey, spec, ownerProps, entryKey, children }: {
  slotKey: string
  spec: SlotSpec<SlotEntryDef>
  ownerProps: object
  entryKey: string | undefined
  children: ReactNode
}) {
  const host = useHost()
  const renderLayers = hocChainFor(host, slotKey, spec, entryKey)
  if (renderLayers === renderHocContent) return children
  return <HocOutletBoundary>{renderLayers(ownerProps, children)}</HocOutletBoundary>
}

export { HocOutlet }
