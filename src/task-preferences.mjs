export const TASK_SETTINGS_NAMESPACE = 'better-tasks-ui'
export const TASK_DETAIL_FONT_MIN = 11
export const TASK_DETAIL_FONT_MAX = 16
export const TASK_COLUMN_LAYOUTS = Object.freeze(['auto', 'single', 'double'])
export const DEFAULT_TASK_PREFERENCES = Object.freeze({
  detailFontSize: 13,
  defaultTodoExpanded: false,
  defaultGoalExpanded: false,
  defaultFinalExpanded: true,
  columnLayout: 'auto',
})

const FIELDS = new Set(Object.keys(DEFAULT_TASK_PREFERENCES))

export function decodeTaskPreferences(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const detailFontSize = value.detailFontSize
  const columnLayout = value.columnLayout
  if (!Number.isInteger(detailFontSize) || detailFontSize < TASK_DETAIL_FONT_MIN || detailFontSize > TASK_DETAIL_FONT_MAX) return undefined
  if (!TASK_COLUMN_LAYOUTS.includes(columnLayout)) return undefined
  for (const field of ['defaultTodoExpanded', 'defaultGoalExpanded', 'defaultFinalExpanded']) {
    if (typeof value[field] !== 'boolean') return undefined
  }
  return Object.freeze({
    detailFontSize,
    defaultTodoExpanded: value.defaultTodoExpanded,
    defaultGoalExpanded: value.defaultGoalExpanded,
    defaultFinalExpanded: value.defaultFinalExpanded,
    columnLayout,
  })
}

function fallbackSnapshot() {
  return Object.freeze({
    status: 'unavailable',
    value: DEFAULT_TASK_PREFERENCES,
    revision: undefined,
    writable: false,
    mode: 'memory',
  })
}

export function createTaskPreferencesStore() {
  let snapshot = fallbackSnapshot()
  let scope
  let unsubscribe
  const listeners = new Set()

  const publish = (next) => {
    if (snapshot.status === next.status && snapshot.value === next.value && snapshot.revision === next.revision && snapshot.writable === next.writable && snapshot.mode === next.mode) return
    snapshot = Object.freeze(next)
    for (const listener of listeners) listener()
  }

  const sync = () => {
    if (scope === undefined) return publish(fallbackSnapshot())
    const source = scope.getSnapshot()
    publish({
      status: source.status,
      value: decodeTaskPreferences(source.value) ?? DEFAULT_TASK_PREFERENCES,
      revision: source.revision,
      writable: source.writable,
      mode: source.mode,
    })
  }

  const disconnect = () => {
    unsubscribe?.()
    unsubscribe = undefined
    scope = undefined
    sync()
  }

  return Object.freeze({
    source: Object.freeze({
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }),
    connect(nextScope) {
      disconnect()
      scope = nextScope
      sync()
      unsubscribe = nextScope.subscribe(sync)
      return () => {
        if (scope !== nextScope) return
        disconnect()
      }
    },
    set(field, value) {
      if (!FIELDS.has(field)) return Promise.reject(new TypeError(`unknown Better Tasks setting: ${String(field)}`))
      if (scope === undefined || !snapshot.writable) return Promise.reject(new Error('Better Tasks settings are not writable'))
      const optimistic = decodeTaskPreferences({ ...snapshot.value, [field]: value })
      if (optimistic === undefined) return Promise.reject(new TypeError(`invalid Better Tasks setting: ${field}`))
      publish({ ...snapshot, value: optimistic })
      return Promise.resolve(scope.set(field, value)).catch((error) => {
        sync()
        throw error
      })
    },
  })
}
