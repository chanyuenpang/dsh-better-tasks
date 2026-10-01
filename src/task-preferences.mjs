export const TASK_SETTINGS_NAMESPACE = 'better-tasks-ui'
// 0.2 dsh-settings.describe emits ns=entry.options.id and write resolves that
// same options.id (lib/index.js:443,502 in 0.2.0-rc.2). Inspect's qualified
// loader id (include:better-tasks-ui) is NOT the settings namespace.
export const TASK_SETTINGS_ENTRY_ID = TASK_SETTINGS_NAMESPACE
export const TASK_DETAIL_FONT_MIN = 11
export const TASK_DETAIL_FONT_MAX = 16
export const TASK_COLUMN_LAYOUTS = Object.freeze(['auto', 'single', 'double'])
export const TASK_TITLE_EMPHASES = Object.freeze(['project', 'task'])
/** Sidebar body the browser shows: the native session list or the task swimlane. */
export const TASK_SIDEBAR_VIEWS = Object.freeze(['native', 'tasks'])
export const DEFAULT_TASK_PREFERENCES = Object.freeze({
  detailFontSize: 13,
  defaultTodoExpanded: false,
  defaultGoalExpanded: false,
  defaultFinalExpanded: true,
  defaultInputExpanded: false,
  columnLayout: 'auto',
  titleEmphasis: 'project',
  sidebarView: 'native',
})

const FIELDS = new Set(Object.keys(DEFAULT_TASK_PREFERENCES))

export function decodeTaskPreferences(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const detailFontSize = value.detailFontSize
  const columnLayout = value.columnLayout
  const titleEmphasis = value.titleEmphasis === undefined ? DEFAULT_TASK_PREFERENCES.titleEmphasis : value.titleEmphasis
  if (!TASK_TITLE_EMPHASES.includes(titleEmphasis)) return undefined
  // Absent reads as the default, like titleEmphasis: rows written before this
  // preference existed must keep decoding.
  const sidebarView = value.sidebarView === undefined ? DEFAULT_TASK_PREFERENCES.sidebarView : value.sidebarView
  if (!TASK_SIDEBAR_VIEWS.includes(sidebarView)) return undefined
  if (!Number.isInteger(detailFontSize) || detailFontSize < TASK_DETAIL_FONT_MIN || detailFontSize > TASK_DETAIL_FONT_MAX) return undefined
  if (!TASK_COLUMN_LAYOUTS.includes(columnLayout)) return undefined
  for (const field of ['defaultTodoExpanded', 'defaultGoalExpanded', 'defaultFinalExpanded', 'defaultInputExpanded']) {
    if (typeof value[field] !== 'boolean') return undefined
  }
  return Object.freeze({
    detailFontSize,
    defaultTodoExpanded: value.defaultTodoExpanded,
    defaultGoalExpanded: value.defaultGoalExpanded,
    defaultFinalExpanded: value.defaultFinalExpanded,
    defaultInputExpanded: value.defaultInputExpanded,
    columnLayout,
    titleEmphasis,
    sidebarView,
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
    const decoded = decodeTaskPreferences(source.value)
    publish({
      status: source.status,
      value: decoded ?? DEFAULT_TASK_PREFERENCES,
      revision: source.revision,
      // ConfigFormController may report the document's writable=true even when
      // this entry is absent. Never write defaults into an unserved namespace.
      writable: source.status === 'ready' && decoded !== undefined && source.writable === true,
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
      const writeScope = scope
      publish({ ...snapshot, value: optimistic })
      const rejected = (error) => {
        if (scope === writeScope) sync()
        throw error
      }
      let result
      try {
        result = writeScope.set(field, value)
      } catch (error) {
        return Promise.reject(error).catch(rejected)
      }
      return Promise.resolve(result).then((accepted) => {
        // 0.2 resolves false after a rejected mutation and recovery read; it does
        // not reject. Legacy settings scopes may resolve void on success.
        if (accepted === false) throw new Error('Better Tasks settings write was rejected by Host')
        return accepted
      }).catch(rejected)
    },
  })
}
