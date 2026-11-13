const renderSlotCache = new WeakMap<StoredEntry, RenderSlotBinding>()

function boundRenderSlot(host: SlotRendererHost, entry: StoredEntry): RenderSlotBinding {
  let binding = renderSlotCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`)
      }
      // Plain-JS backstop; typed callers are narrowed to the declared keys.
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind === 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`)
      }
      return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} declaredInline={declared.inline === true} />
    }
    renderSlotCache.set(entry, binding)
  }
  return binding
}


const factoryRenderSlotCache = new WeakMap<StoredFactory, RenderSlotBinding>()
const factoryRenderSlotChainCache = new WeakMap<StoredFactory, RenderSlotChainBinding>()

function boundFactoryRenderSlot(host: SlotRendererHost, definition: StoredFactory): RenderSlotBinding {
  let binding = factoryRenderSlotCache.get(definition)
  if (binding !== undefined) return binding
  binding = (key, owner, opts) => {
    if (!host.isFactoryLive(definition)) {
      throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed Factory`)
    }
    const declared = definition.children?.[key]
    if (declared === undefined) throw new SlotOwnershipError(`slot '${key}' is not declared by this Factory`)
    if (declared.kind === 'chain') throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`)
    return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} declaredInline={declared.inline === true} />
  }
  factoryRenderSlotCache.set(definition, binding)
  return binding
}


export { boundRenderSlot, boundFactoryRenderSlot }
