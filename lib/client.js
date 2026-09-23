window.__ModuleLoader__.load({
  id: "dsh-better-tasks",
  factory: requireModule => {
    const EMPTY_QUEUE = Object.freeze({
      schemaVersion: 1,
      revision: 0,
      sessionIds: Object.freeze([]),
      updatedAt: '',
    })

    function validQueue(value) {
      return value !== null && typeof value === 'object' && value.schemaVersion === 1 &&
        Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.sessionIds) &&
        value.sessionIds.every((id) => typeof id === 'string' && id.length > 0) &&
        new Set(value.sessionIds).size === value.sessionIds.length && typeof value.updatedAt === 'string'
    }

    function ownedQueue(value) {
      if (!validQueue(value)) throw new Error('better-tasks: Host returned an invalid pin queue')
      return Object.freeze({
        schemaVersion: 1,
        revision: value.revision,
        sessionIds: Object.freeze([...value.sessionIds]),
        updatedAt: value.updatedAt,
      })
    }

    function createClientSource(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set(next) {
          snapshot = next
          for (const listener of listeners) listener()
        },
      }
    }

    async function pinRequest(method, body) {
      const response = await fetch('/api/better-tasks/pins', {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = {}
      }
      return { response, payload }
    }

    function createTaskPinsClient() {
      const source = createClientSource(Object.freeze({
        phase: 'loading',
        queue: EMPTY_QUEUE,
        pendingSessionIds: Object.freeze([]),
        error: null,
      }))
      const pending = new Set()
      const optimisticPins = new Map()
      let confirmedQueue = EMPTY_QUEUE
      let tail = Promise.resolve()
      let disposed = false

      const projectedQueue = () => {
        if (optimisticPins.size === 0) return confirmedQueue
        let sessionIds = [...confirmedQueue.sessionIds]
        for (const [sessionId, pinned] of optimisticPins) {
          const index = sessionIds.indexOf(sessionId)
          if (pinned && index === -1) sessionIds.push(sessionId)
          if (!pinned && index !== -1) sessionIds.splice(index, 1)
        }
        return Object.freeze({
          ...confirmedQueue,
          sessionIds: Object.freeze(sessionIds),
        })
      }
      const publish = (patch = {}) => {
        if (disposed) return
        const previous = source.getSnapshot()
        source.set(Object.freeze({
          ...previous,
          ...patch,
          queue: projectedQueue(),
          pendingSessionIds: Object.freeze([...pending]),
        }))
      }
      const adopt = (queue) => {
        confirmedQueue = ownedQueue(queue)
        publish({ phase: 'ready', error: null })
        return confirmedQueue
      }
      const enqueue = (work) => {
        const next = tail.then(work, work)
        tail = next.catch(() => {})
        return next
      }

      const refresh = () => enqueue(async () => {
        const { response, payload } = await pinRequest('GET')
        if (!response.ok) throw new Error(payload.message ?? `pin queue read failed (${response.status})`)
        return adopt(payload.queue)
      }).catch((error) => {
        publish({ phase: source.getSnapshot().phase === 'loading' ? 'error' : source.getSnapshot().phase, error: String(error?.message ?? error) })
        throw error
      })

      const mutate = (sessionId, commandFor, optimisticPinned) => {
        const visibleQueue = source.getSnapshot().queue
        if (optimisticPinned !== undefined && visibleQueue.sessionIds.includes(sessionId) === optimisticPinned) {
          return Promise.resolve(visibleQueue)
        }
        pending.add(sessionId)
        if (optimisticPinned !== undefined) optimisticPins.set(sessionId, optimisticPinned)
        publish({ error: null })
        return enqueue(async () => {
          try {
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const command = commandFor(confirmedQueue)
              if (command === null) return confirmedQueue
              const { response, payload } = await pinRequest('POST', command)
              if (response.ok) return adopt(payload.queue)
              if (response.status === 409 && validQueue(payload.queue)) {
                adopt(payload.queue)
                continue
              }
              throw new Error(payload.message ?? `pin queue write failed (${response.status})`)
            }
            throw new Error('pin queue changed again; retry the action')
          } finally {
            pending.delete(sessionId)
            optimisticPins.delete(sessionId)
            publish({})
          }
        }).catch((error) => {
          publish({ error: String(error?.message ?? error) })
          throw error
        })
      }

      return {
        source,
        refresh,
        setPinned(sessionId, pinned) {
          return mutate(sessionId, (queue) => {
            const alreadyPinned = queue.sessionIds.includes(sessionId)
            if (alreadyPinned === pinned) return null
            return {
              action: pinned ? 'pin' : 'unpin',
              sessionId,
              expectedRevision: queue.revision,
            }
          }, pinned)
        },
        pinCreated(sessionId) {
          return mutate(sessionId, (queue) => queue.sessionIds.includes(sessionId) ? null : {
            action: 'pin-created',
            sessionId,
            expectedRevision: queue.revision,
          }, true)
        },
        moveBefore(sessionId, beforeSessionId) {
          return mutate(sessionId, (queue) => ({
            action: 'move',
            sessionId,
            beforeSessionId: beforeSessionId ?? null,
            expectedRevision: queue.revision,
          }))
        },
        start() {
          if (typeof window === 'undefined') return () => { disposed = true }
          const onFocus = () => { refresh().catch(() => {}) }
          window.addEventListener('focus', onFocus)
          refresh().catch(() => {})
          return () => {
            disposed = true
            window.removeEventListener('focus', onFocus)
          }
        },
      }
    }

    const SIDEBAR_CHILD_SLOTS = Object.freeze([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'sidebar.panellist',
      'sidebar.workspaces',
      'sidebar.settings',
      'sidebar.footer.action',
    ])

    function createSidebarChildDeclarations() {
      return Object.fromEntries(SIDEBAR_CHILD_SLOTS.map((name) => [name, {
        kind: name === 'sidebar.panellist' || name === 'sidebar.footer.action' ? 'list' : 'single',
        scope: 'root',
      }]))
    }

    const ACTIVITY_RANGE_DAYS = Object.freeze({
      all: null,
      '1d': 1,
      '3d': 3,
      '7d': 7,
      '14d': 14,
    })

    const DAY_MS = 24 * 60 * 60 * 1000

    function compareStableRecency(left, right) {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
      const leftId = String(left.id)
      const rightId = String(right.id)
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
    }

    function beforeIdForTaskDrop(orderedIds, overId, half) {
      if (half !== 'before' && half !== 'after') throw new Error(`unsupported drop half: ${half}`)
      const index = orderedIds.indexOf(overId)
      if (index === -1) throw new Error(`unknown drop target: ${overId}`)
      return half === 'before' ? overId : orderedIds[index + 1] ?? null
    }

    function indexWorkspacesBySession(workspaces) {
      const index = new Map()
      for (const workspace of workspaces) {
        for (const sessionId of workspace.sessionIds) {
          if (!index.has(sessionId)) index.set(sessionId, workspace)
        }
      }
      return index
    }

    async function loadProjectAppearances(fetchImpl, url = '/api/project-appearance') {
      try {
        const response = await fetchImpl(url, { cache: 'no-store' })
        if (!response.ok) throw new Error(`appearance request failed: ${response.status}`)
        const payload = await response.json()
        if (!Array.isArray(payload.items) || !Array.isArray(payload.icons)) {
          throw new Error('appearance response is missing items or icons')
        }
        return Object.freeze({
          status: 'ready',
          items: payload.items,
          icons: payload.icons,
          colorKeys: Array.isArray(payload.colorKeys) ? payload.colorKeys : [],
        })
      } catch (error) {
        return Object.freeze({
          status: 'unavailable',
          items: [],
          icons: [],
          colorKeys: [],
          error: String(error?.message ?? error),
        })
      }
    }

    function summarizeGoal(value) {
      if (value === undefined) return Object.freeze({ availability: 'unknown' })
      if (value === null || value.goal.phase === 'complete') return Object.freeze({ availability: 'none' })
      const reason = value.goal.blockedReason
      return Object.freeze({
        availability: 'ready',
        id: value.goal.id,
        phase: value.goal.phase,
        objective: value.goal.objective,
        roundsStarted: value.roundsStarted,
        maxGoalRounds: value.goal.maxGoalRounds,
        blockedReason: reason === undefined ? undefined : Object.freeze({ code: reason.code, message: reason.message }),
      })
    }

    function summarizeTodos(value) {
      if (value === undefined) return Object.freeze({ availability: 'unknown' })
      if (value === null) return Object.freeze({ availability: 'none' })
      const counts = { pending: 0, inProgress: 0, completed: 0, total: value.length }
      const items = value.map((todo) => {
        if (todo.status === 'pending') counts.pending += 1
        else if (todo.status === 'in_progress') counts.inProgress += 1
        else if (todo.status === 'completed') counts.completed += 1
        return Object.freeze({ content: todo.content, status: todo.status })
      })
      return Object.freeze({ availability: 'ready', ...counts, items: Object.freeze(items) })
    }

    function summarizeSession(summary, pendingInteraction) {
      if (pendingInteraction !== undefined) {
        return Object.freeze({ status: 'block', interaction: pendingInteraction.kind })
      }
      if (summary.running) return Object.freeze({ status: 'running' })
      return Object.freeze({ status: 'idle' })
    }

    function projectTask(summary, currentId, pendingInteraction) {
      const projections = summary.projectionValues
      return Object.freeze({
        id: summary.id,
        title: summary.displayTitle ?? summary.title ?? String(summary.id),
        cwd: summary.cwd,
        updatedAt: summary.updatedAt,
        current: summary.id === currentId,
        goal: summarizeGoal(projections?.goal),
        todos: summarizeTodos(projections?.todos),
        session: summarizeSession(summary, pendingInteraction),
      })
    }

    /** Derive task cards in the exact Host-owned pin order. */
    function derivePinnedTasks({ list, pinnedSessionIds, pendingInteractions = new Map() }) {
      if (!Array.isArray(pinnedSessionIds)) throw new Error('pinnedSessionIds must be an array')
      const seen = new Set()
      const tasks = []
      for (const id of pinnedSessionIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const summary = list.byId[id]
        if (summary === undefined || summary.blank || summary.origin === 'subagent') continue
        tasks.push(projectTask(summary, list.current, pendingInteractions.get(id)))
      }
      return tasks
    }

    /**
     * Legacy bounded recent projection retained for compatibility tests and rollback.
     * The task UI no longer uses it as membership or ordering authority.
     */
    function deriveRecentTasks({
      list,
      archivedSessionIds = [],
      pendingInteractions = new Map(),
      activityRange = 'all',
      now = Date.now(),
      limit = 10,
    }) {
      if (!Object.hasOwn(ACTIVITY_RANGE_DAYS, activityRange)) {
        throw new Error(`unsupported activity range: ${activityRange}`)
      }
      if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('limit must be a non-negative safe integer')

      const archived = new Set(archivedSessionIds)
      const days = ACTIVITY_RANGE_DAYS[activityRange]
      const cutoff = days === null ? Number.NEGATIVE_INFINITY : now - days * DAY_MS
      const visible = []

      for (const id of list.ids) {
        const summary = list.byId[id]
        if (summary === undefined) continue
        if (summary.blank || summary.origin === 'subagent' || archived.has(summary.id)) continue
        if (summary.updatedAt < cutoff) continue
        visible.push(summary)
      }

      visible.sort(compareStableRecency)
      return visible.slice(0, limit).map((summary) => projectTask(summary, list.current, pendingInteractions.get(summary.id)))
    }

    const name = 'dsh-better-tasks'
    // The shared question surface is optional: older/native question packages keep
    // their composer behavior without delaying sidebar, Session, or Workspace startup.
    const inject = ['slots', 'layout', 'locale']

    const NS = 'better-tasks-sidebar'
    const STYLE_ID = 'dsh-better-tasks/sidebar'
    const TASK_GRID_TWO_COLUMN_THRESHOLD = 528
    const FINAL_CACHE_KEY = 'dsh-better-tasks.final-message-cache.v1'
    const dictionaries = {
      zh: {
        'brand.fallback': 'DSH',
        'session.new': '新会话',
        'session.new.label': '新建会话',
        'toggle.open': '打开侧边栏',
        'toggle.collapse': '收起侧边栏',
        'panels.label': '全局面板',
        'view.native': '会话',
        'view.tasks': '任务',
        'tasks.goal': 'Goal',
        'tasks.todo': 'Todo',
        'tasks.empty': '还没有 Pin 任务',
        'tasks.expandGoal': '展开 Goal',
        'tasks.collapseGoal': '收起 Goal',
        'tasks.expandTodo': '展开 Todo',
        'tasks.collapseTodo': '收起 Todo',
        'tasks.final': 'Final',
        'tasks.expandFinal': '展开 Final message',
        'tasks.collapseFinal': '收起 Final message',
        'tasks.finalLoading': '正在读取 Final message…',
        'tasks.finalNone': '没有 Final message',
        'tasks.finalError': 'Final message 读取失败',
        'tasks.finalRetry': '重试',
        'tasks.finalTruncated': '内容已截断',
        'tasks.unpin': '从任务中移除',
        'tasks.runningAria': '运行中',
        'tasks.blockAria': '等待交互',
        'tasks.idleAria': '空闲',
        'tasks.appearanceUnavailable': '项目外观暂不可用',
        'tasks.unknown': '未知',
        'tasks.none': '无',
        'tasks.editAppearance': '设置项目图标和颜色',
        'tasks.appearanceTitle': '项目外观',
        'tasks.iconSearch': '搜索图标',
        'tasks.cancel': '取消',
        'tasks.save': '保存',
        'time.now': '刚刚',
        'time.minutes': '{n}分钟',
        'time.hours': '{n}小时',
        'time.days': '{n}天',
        'time.months': '{n}个月',
        'time.years': '{n}年',
      },
      en: {
        'brand.fallback': 'DSH',
        'session.new': 'New Session',
        'session.new.label': 'New session',
        'toggle.open': 'Open sidebar',
        'toggle.collapse': 'Collapse sidebar',
        'panels.label': 'Global panels',
        'view.native': 'Sessions',
        'view.tasks': 'Tasks',
        'tasks.goal': 'Goal',
        'tasks.todo': 'Todo',
        'tasks.empty': 'No pinned tasks yet',
        'tasks.expandGoal': 'Expand Goal',
        'tasks.collapseGoal': 'Collapse Goal',
        'tasks.expandTodo': 'Expand Todo',
        'tasks.collapseTodo': 'Collapse Todo',
        'tasks.final': 'Final',
        'tasks.expandFinal': 'Expand final message',
        'tasks.collapseFinal': 'Collapse final message',
        'tasks.finalLoading': 'Loading final message…',
        'tasks.finalNone': 'No final message',
        'tasks.finalError': 'Failed to load final message',
        'tasks.finalRetry': 'Retry',
        'tasks.finalTruncated': 'Content truncated',
        'tasks.unpin': 'Unpin task',
        'tasks.runningAria': 'Running',
        'tasks.blockAria': 'Waiting for interaction',
        'tasks.idleAria': 'Idle',
        'tasks.appearanceUnavailable': 'Project appearance is unavailable',
        'tasks.unknown': 'Unknown',
        'tasks.none': 'None',
        'tasks.editAppearance': 'Set project icon and color',
        'tasks.appearanceTitle': 'Project appearance',
        'tasks.iconSearch': 'Search icons',
        'tasks.cancel': 'Cancel',
        'tasks.save': 'Save',
        'time.now': 'now',
        'time.minutes': '{n}min',
        'time.hours': '{n}h',
        'time.days': '{n}d',
        'time.months': '{n}mo',
        'time.years': '{n}y',
      },
    }

    const css = `
    .dbt-sidebar{--dbt-pad:12px;box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px var(--dbt-pad);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
    .dbt-sidebar[data-wide="false"]{--dbt-pad:8px;align-items:center;padding-inline:8px}
    .dbt-brand-row{width:100%;height:32px;display:flex;align-items:center;gap:6px;flex:none}
    .dbt-brand,.dbt-icon-button,.dbt-new-session,.dbt-panel-row{border:0;font:inherit;color:inherit;cursor:pointer}
    .dbt-brand{min-width:0;display:flex;align-items:center;gap:8px;flex:1;background:transparent;padding:0 4px;text-align:left}
    .dbt-brand-mark,.dbt-panel-glyph,.dbt-rail-mark{display:inline-flex;align-items:center;justify-content:center;flex:none}
    .dbt-brand-name,.dbt-panel-label,.dbt-new-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dbt-brand-name{font-weight:650}
    .dbt-icon-button{corner-shape:round;width:28px;height:28px;color:var(--dsw-alias-label-secondary);border:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0;background:transparent;flex:none}
    .dbt-icon-button:hover,.dbt-panel-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .dbt-sidebar[data-wide="false"] .dbt-brand-row{height:36px}
    .dbt-sidebar[data-wide="false"] .dbt-icon-button{width:36px;height:36px;color:var(--dsw-alias-label-primary)}
    .dbt-sidebar[data-wide="false"] .dbt-toggle .dbt-panel-icon{display:none}
    .dbt-sidebar[data-wide="false"] .dbt-toggle:hover .dbt-panel-icon{display:inline}
    .dbt-sidebar[data-wide="false"] .dbt-toggle:hover .dbt-rail-mark{display:none}
    .dbt-new-session{width:100%;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:0 10px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-static-white,#fff);font-weight:600;flex:none}
    .dbt-sidebar[data-wide="false"] .dbt-new-session{width:36px;height:36px;justify-content:center;padding:0;border-radius:10px}
    .dbt-panel-list{width:100%;display:flex;flex-direction:column;gap:2px;flex:none}
    .dbt-panel-row{width:100%;height:34px;border-radius:9px;display:flex;align-items:center;gap:8px;padding:0 10px;background:transparent;text-align:left}
    .dbt-panel-row[aria-current="page"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
    .dbt-sidebar[data-wide="false"] .dbt-panel-row{width:36px;height:36px;justify-content:center;padding:0}
    .dbt-workspaces{width:100%;min-height:0;display:flex;flex:1;overflow:hidden}
    .dbt-foot{width:100%;display:flex;flex-direction:column;gap:4px;flex:none}
    .dbt-footer-actions,.dbt-settings{width:100%}
    .dbt-sidebar[data-wide="false"] .dbt-footer-actions,.dbt-sidebar[data-wide="false"] .dbt-settings{display:flex;justify-content:center}
    .dbt-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .dbt-region-shell{width:100%;min-height:0;display:flex;flex:1;flex-direction:column;overflow:hidden}
    .dbt-view-tabs{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:0 4px;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;flex:none}
    .dbt-view-tab{height:30px;margin:0 0 -1px;border:1px solid transparent;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}
    .dbt-view-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
    .dbt-view-tab[aria-selected="true"]{border-color:var(--dsw-alias-border-l1);border-bottom-color:var(--dsw-alias-bg-layer-2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:none}
    .dbt-region-panel{min-height:0;display:flex;flex:1;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-top:0;border-radius:0 0 10px 10px;padding:6px}
    .dbt-task-view{min-height:0;display:flex;flex:1;flex-direction:column;gap:7px;overflow:hidden}
    .dbt-task-list{min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;display:grid;grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;align-content:start;align-items:start;gap:7px;padding:2px}
    .dbt-task-list[data-columns="2"]{display:flex;align-items:flex-start}
    .dbt-task-column{min-width:0;flex:1;display:flex;flex-direction:column;gap:7px}
    .dbt-task-card{--dbt-task-border:color-mix(in srgb,currentColor 10%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,var(--dsw-alias-label-primary));position:relative;box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dbt-task-border);border-radius:11px;background:var(--dsw-alias-bg-layer-1);padding:9px;display:flex;flex-direction:column;gap:8px;cursor:pointer;box-shadow:none}
    .dbt-task-card[data-state="idle"]{--dbt-task-border:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-label-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-alias-bg-layer-1))}
    .dbt-task-card[data-state="running"]{--dbt-task-border:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 24%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 58%,transparent);background:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 12%,var(--dsw-alias-bg-layer-1))}
    .dbt-task-card[data-state="block"]{--dbt-block-yellow:#d2aa00;--dbt-task-border:color-mix(in srgb,var(--dbt-block-yellow) 34%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dbt-block-yellow) 72%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dbt-block-yellow) 18%,var(--dsw-alias-bg-layer-1))}
    .dbt-task-card[data-current="true"]{border-color:var(--dbt-task-border-selected);box-shadow:none}
    .dbt-task-card[data-drop="before"]:before,.dbt-task-card[data-drop="after"]:after{content:"";position:absolute;z-index:2;left:8px;right:8px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary);pointer-events:none}
    .dbt-task-card[data-drop="before"]:before{top:1px}.dbt-task-card[data-drop="after"]:after{bottom:1px}
    .dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="before"]:before,.dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="after"]:after{top:8px;bottom:8px;width:2px;height:auto}
    .dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="before"]:before{left:1px;right:auto}.dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="after"]:after{left:auto;right:1px}
    .dbt-task-title-row{display:flex;align-items:center;gap:7px;min-width:0}
    .dbt-task-open{min-width:0;flex:1;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0}
    .dbt-task-project{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:680;line-height:19px}
    .dbt-task-session-line{display:flex;align-items:center;gap:5px;min-width:0;margin-top:1px}
    .dbt-task-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
    .dbt-task-time{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
    .dbt-project-icon{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;flex:none;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
    .dbt-project-icon:disabled{cursor:default;opacity:.72}
    .dbt-task-unpin{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;opacity:0;pointer-events:none;transition:background .12s ease,border-color .12s ease}
    .dbt-task-unpin svg{width:14px;height:14px;flex:none}
    .dbt-task-unpin[aria-pressed="true"]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
    .dbt-task-card:hover .dbt-task-unpin,.dbt-task-card:focus-within .dbt-task-unpin,.dbt-task-unpin:focus-visible{opacity:1;pointer-events:auto}
    .dbt-task-unpin:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 36%,transparent)}
    .dbt-task-unpin:disabled{cursor:default;opacity:.45}
    .dbt-task-projection-bar{display:flex;align-items:center;gap:5px}
    .dbt-projection-toggle{height:27px;min-width:34px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}
    .dbt-projection-toggle:hover,.dbt-projection-toggle[aria-expanded="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
    .dbt-projection-toggle:disabled{cursor:default;opacity:.38;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
    .dbt-todo-count{font-size:10px;font-variant-numeric:tabular-nums}
    .dbt-projection-details{display:flex;flex-direction:column;gap:6px;padding-top:1px}
    .dbt-projection-detail{display:grid;grid-template-columns:18px minmax(0,1fr);gap:6px;align-items:start;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,transparent);padding:7px;font-size:12px;line-height:1.45}
    .dbt-projection-detail.dbt-final-detail{display:block}
    .dbt-projection-detail[data-tone="blocked"]{color:var(--dsw-alias-error,#d14343)}
    .dbt-projection-copy{min-width:0;overflow-wrap:anywhere}
    .dbt-final-copy{white-space:pre-wrap;overflow-wrap:anywhere}
    .dbt-final-meta{margin-top:5px;color:var(--dsw-alias-label-tertiary);font-size:10px}
    .dbt-final-retry{margin-top:5px;border:0;border-radius:6px;padding:3px 7px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);cursor:pointer}
    .dbt-question-surface{min-width:0;max-width:100%;overflow:hidden}
    .dbt-question-surface *{min-width:0}
    .dbt-todo-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
    .dbt-todo-item{display:grid;grid-template-columns:16px minmax(0,1fr);gap:5px;align-items:start}
    .dbt-task-empty,.dbt-task-warning{padding:10px;border-radius:9px;font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
    .dbt-task-warning{padding:6px 8px;color:var(--dsw-alias-warning,#a26900)}
    .dbt-dialog-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:color-mix(in srgb,#000 38%,transparent);padding:20px}
    .dbt-dialog{width:min(680px,92vw);max-height:min(720px,90vh);overflow:auto;border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px;display:flex;flex-direction:column;gap:12px}
    .dbt-dialog h2{font-size:16px;margin:0}
    .dbt-dialog input{height:34px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;padding:0 10px}
    .dbt-icon-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;max-height:360px;overflow:auto}
    .dbt-icon-choice{aspect-ratio:1;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:7px;background:transparent;color:inherit;cursor:pointer;display:grid;place-items:center}
    .dbt-icon-choice[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
    .dbt-color-row{display:flex;flex-wrap:wrap;gap:7px}
    .dbt-color-choice{width:25px;height:25px;border-radius:50%;border:2px solid transparent;cursor:pointer}
    .dbt-color-choice[data-selected="true"]{outline:2px solid currentColor;outline-offset:2px}
    .dbt-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
    .dbt-dialog-actions button{height:32px;border:0;border-radius:8px;padding:0 12px;cursor:pointer}
    .dbt-dialog-save{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-static-white,#fff)}
    @media (prefers-reduced-motion:no-preference){.dbt-sidebar,.dbt-panel-row,.dbt-icon-button,.dbt-task-card{transition:background-color .15s ease,color .15s ease,border-color .15s ease}}
    `

    function createSnapshotStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set(next) {
          snapshot = next
          for (const listener of listeners) listener()
        },
      }
    }

    function resolveLabel(label, fallback) {
      if (typeof label === 'function') return String(label())
      return typeof label === 'string' && label !== '' ? label : fallback
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const previous = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (previous !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = name
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    function element(type, props, ...children) {
      return requireModule('react').createElement(type, props, ...children)
    }

    const COLOR_HEX = Object.freeze({
      blue: '#3b82f6', cyan: '#06b6d4', green: '#22c55e', orange: '#f97316',
      pink: '#ec4899', purple: '#8b5cf6', red: '#ef4444', yellow: '#eab308',
      teal: '#14b8a6', indigo: '#6366f1', amber: '#f59e0b', slate: '#64748b', black: '#111827',
    })

    function useStoredPreference(key, fallback, allowed) {
      const React = requireModule('react')
      const [value, setValue] = React.useState(() => {
        if (typeof localStorage === 'undefined') return fallback
        try {
          const stored = localStorage.getItem(key)
          return stored !== null && allowed.includes(stored) ? stored : fallback
        } catch {
          return fallback
        }
      })
      React.useEffect(() => {
        if (typeof localStorage === 'undefined') return
        try { localStorage.setItem(key, value) } catch {}
      }, [key, value])
      return [value, setValue]
    }

    function expandFinalForIdleCycles(cycles, idleTasks, value) {
      const nextCycles = { ...cycles }
      const nextExpanded = { ...value }
      let cyclesChanged = false
      let expandedChanged = false
      for (const task of idleTasks) {
        if (nextCycles[task.id] === task.updatedAt) continue
        nextCycles[task.id] = task.updatedAt
        cyclesChanged = true
        const key = `${task.id}:final`
        if (nextExpanded[key] === true) continue
        nextExpanded[key] = true
        expandedChanged = true
      }
      return {
        cycles: cyclesChanged ? nextCycles : cycles,
        expanded: expandedChanged ? nextExpanded : value,
      }
    }

    function reconcileGoalExpansionCycles(cycles, goals, endedSessionIds, value) {
      const nextCycles = { ...cycles }
      const nextExpanded = { ...value }
      let cyclesChanged = false
      let expandedChanged = false
      for (const sessionId of endedSessionIds) {
        if (Object.hasOwn(nextCycles, sessionId)) {
          delete nextCycles[sessionId]
          cyclesChanged = true
        }
        const key = `${sessionId}:goal`
        if (nextExpanded[key] === true) {
          delete nextExpanded[key]
          expandedChanged = true
        }
      }
      for (const goal of goals) {
        if (nextCycles[goal.id] === goal.goalId) continue
        nextCycles[goal.id] = goal.goalId
        cyclesChanged = true
        const key = `${goal.id}:goal`
        if (nextExpanded[key] === true) continue
        nextExpanded[key] = true
        expandedChanged = true
      }
      return {
        cycles: cyclesChanged ? nextCycles : cycles,
        expanded: expandedChanged ? nextExpanded : value,
      }
    }

    function parseFinalMessageCache(raw) {
      if (typeof raw !== 'string' || raw === '') return {}
      try {
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const states = {}
        for (const [sessionId, entry] of Object.entries(parsed).slice(-100)) {
          if (entry === null || typeof entry !== 'object' || entry.status !== 'ready') continue
          if (!['string', 'number'].includes(typeof entry.updatedAt)) continue
          const value = entry.value
          if (value === null || typeof value !== 'object' || value.sessionId !== sessionId) continue
          if (value.final !== null && (typeof value.final !== 'object' || typeof value.final.text !== 'string' || [...value.final.text].length > 4000)) continue
          states[sessionId] = { status: 'ready', updatedAt: entry.updatedAt, value }
        }
        return states
      } catch {
        return {}
      }
    }

    function serializeFinalMessageCache(states) {
      const ready = Object.entries(states).filter(([, entry]) => entry?.status === 'ready').slice(-100)
      return JSON.stringify(Object.fromEntries(ready))
    }

    function loadFinalMessageCache() {
      if (typeof localStorage === 'undefined') return {}
      try { return parseFinalMessageCache(localStorage.getItem(FINAL_CACHE_KEY) ?? '') } catch { return {} }
    }

    function useStoredExpansion(key) {
      const React = requireModule('react')
      const [value, setValue] = React.useState(() => {
        if (typeof localStorage === 'undefined') return {}
        try {
          const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
          return Object.fromEntries(Object.entries(parsed).filter(([entryKey, expanded]) => entryKey.length > 0 && expanded === true))
        } catch {
          return {}
        }
      })
      React.useEffect(() => {
        if (typeof localStorage === 'undefined') return
        try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
      }, [key, value])
      return [value, setValue]
    }

    function useStoredRecord(key) {
      const React = requireModule('react')
      const [value, setValue] = React.useState(() => {
        if (typeof localStorage === 'undefined') return {}
        try {
          const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
          return Object.fromEntries(Object.entries(parsed).filter(([entryKey, cycle]) => entryKey.length > 0 && ['string', 'number'].includes(typeof cycle)).slice(-100))
        } catch {
          return {}
        }
      })
      React.useEffect(() => {
        if (typeof localStorage === 'undefined') return
        try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
      }, [key, value])
      return [value, setValue]
    }

    function useProjectAppearanceSnapshot() {
      const React = requireModule('react')
      const [state, setState] = React.useState({ status: 'loading', items: [], icons: [], colorKeys: [] })
      const [revision, setRevision] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        loadProjectAppearances((url, options) => fetch(url, options)).then((next) => {
          if (alive) setState(next)
        })
        return () => { alive = false }
      }, [revision])
      React.useEffect(() => {
        if (typeof window === 'undefined') return
        const reload = () => setRevision((value) => value + 1)
        window.addEventListener('project-appearance-changed', reload)
        return () => window.removeEventListener('project-appearance-changed', reload)
      }, [])
      return state
    }

    function renderCatalogIcon(icon, size = 18) {
      if (icon === undefined) return element('span', { 'aria-hidden': 'true' }, '◇')
      return element('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, ...icon.nodes.map(([tag, props], index) => element(tag, { ...props, key: `${tag}-${index}` })))
    }

    function renderTaskPinIcon(size = 14) {
      return element('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
      element('path', { d: 'M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4' }),
      element('path', { d: 'M9 15l-4.5 4.5' }),
      element('path', { d: 'M14.5 4l5.5 5.5' }))
    }

    function AppearanceDialog({ workspace, appearance, appearanceState, onClose, t }) {
      const React = requireModule('react')
      const [query, setQuery] = React.useState('')
      const [iconKey, setIconKey] = React.useState(appearance?.iconKey ?? 'folder')
      const [colorKey, setColorKey] = React.useState(appearance?.colorKey ?? 'blue')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const colors = appearanceState.colorKeys.length > 0 ? appearanceState.colorKeys : Object.keys(COLOR_HEX)
      const needle = query.trim().toLowerCase()
      const icons = appearanceState.icons.filter((icon) => needle === '' || String(icon.label ?? icon.key).toLowerCase().includes(needle)).slice(0, 160)

      const save = async () => {
        setBusy(true)
        setError('')
        try {
          const response = await fetch('/api/project-appearance', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspaceId: workspace.workspaceId, iconKey, colorKey }),
          })
          if (!response.ok) throw new Error(`save failed: ${response.status}`)
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('project-appearance-changed'))
          onClose()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
          setBusy(false)
        }
      }

      return element('div', { className: 'dbt-dialog-backdrop', role: 'presentation', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        element('section', { className: 'dbt-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tasks.appearanceTitle') },
          element('h2', null, `${t('tasks.appearanceTitle')} · ${workspace.title}`),
          element('input', {
            value: query,
            placeholder: t('tasks.iconSearch'),
            'aria-label': t('tasks.iconSearch'),
            onChange: (event) => setQuery(event.target.value),
          }),
          element('div', { className: 'dbt-icon-grid' }, ...icons.map((icon) => element('button', {
            key: icon.key,
            type: 'button',
            className: 'dbt-icon-choice',
            'data-selected': String(icon.key === iconKey),
            title: icon.label ?? icon.key,
            'aria-label': icon.label ?? icon.key,
            onClick: () => setIconKey(icon.key),
          }, renderCatalogIcon(icon, 21)))),
          element('div', { className: 'dbt-color-row', 'aria-label': 'Colors' }, ...colors.map((key) => element('button', {
            key,
            type: 'button',
            className: 'dbt-color-choice',
            'data-selected': String(key === colorKey),
            style: { background: COLOR_HEX[key] ?? '#64748b', color: COLOR_HEX[key] ?? '#64748b' },
            title: key,
            'aria-label': key,
            onClick: () => setColorKey(key),
          }))),
          error !== '' ? element('div', { className: 'dbt-task-warning', role: 'alert' }, error) : null,
          element('div', { className: 'dbt-dialog-actions' },
            element('button', { type: 'button', onClick: onClose, disabled: busy }, t('tasks.cancel')),
            element('button', { type: 'button', className: 'dbt-dialog-save', onClick: save, disabled: busy || icons.length === 0 }, t('tasks.save')))))
    }

    function availabilityLabel(value, t) {
      if (value.availability === 'unknown') return t('tasks.unknown')
      if (value.availability === 'none') return t('tasks.none')
      return ''
    }

    function compactRelativeTime(updatedAt, now, t, relativeTime) {
      const { unit, n } = relativeTime(updatedAt, now)
      return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
    }

    function TaskSwimlane({ useSessions, useWorkspaces, useSessionPendingInteraction, useTaskPins, openSession, moveTaskBefore, unpinTask, renderQuestion, twoColumns, t }) {
      const React = requireModule('react')
      const {
        IconCheckOutline14,
        IconChecklistOutline14,
        IconChevronDownOutline14,
        IconChevronRightOutline14,
        IconClockOutline16,
        IconGoalOutline16,
        IconSparkle16,
        StateDot,
        relativeTime,
      } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
      const list = useSessions((snapshot) => snapshot)
      const workspaces = useWorkspaces((snapshot) => snapshot)
      const pendingInteractions = useSessionPendingInteraction((snapshot) => snapshot)
      const taskPins = useTaskPins((snapshot) => snapshot)
      const appearanceState = useProjectAppearanceSnapshot()
      const [editingWorkspaceId, setEditingWorkspaceId] = React.useState(null)
      const [expanded, setExpanded] = useStoredExpansion('dsh-better-tasks.projection-expansion.v1')
      const [finalAutoCycles, setFinalAutoCycles] = useStoredRecord('dsh-better-tasks.final-auto-open-cycle.v1')
      const [goalAutoCycles, setGoalAutoCycles] = useStoredRecord('dsh-better-tasks.goal-auto-open-cycle.v1')
      const [drag, setDrag] = React.useState(null)
      const dragClickGuard = React.useRef(null)
      const [moveError, setMoveError] = React.useState('')

      const tasks = derivePinnedTasks({
        list,
        pinnedSessionIds: taskPins.queue.sessionIds,
        pendingInteractions,
      })
      const taskIds = tasks.map((task) => task.id)
      const goalTasks = tasks.filter((task) => task.goal.availability === 'ready' && typeof task.goal.id === 'string').map((task) => ({ id: task.id, goalId: task.goal.id }))
      const endedGoalTaskIds = tasks.filter((task) => task.goal.availability === 'none').map((task) => task.id)
      const goalCycleKey = `${goalTasks.map((task) => `${task.id}:${task.goalId}`).join('|')}::${endedGoalTaskIds.join('|')}`
      React.useEffect(() => {
        const next = reconcileGoalExpansionCycles(goalAutoCycles, goalTasks, endedGoalTaskIds, expanded)
        if (next.cycles !== goalAutoCycles) setGoalAutoCycles(next.cycles)
        if (next.expanded !== expanded) setExpanded(next.expanded)
      }, [goalCycleKey])
      const idleTasks = tasks.filter((task) => task.session.status === 'idle').map((task) => ({ id: task.id, updatedAt: task.updatedAt }))
      const idleCycleKey = idleTasks.map((task) => `${task.id}:${task.updatedAt}`).join('|')
      React.useEffect(() => {
        const unseen = idleTasks.filter((task) => finalAutoCycles[task.id] !== task.updatedAt)
        if (unseen.length === 0) return
        setFinalAutoCycles((cycles) => expandFinalForIdleCycles(cycles, unseen, {}).cycles)
        setExpanded((value) => expandFinalForIdleCycles({}, unseen, value).expanded)
      }, [idleCycleKey])
      const [finalStates, setFinalStates] = React.useState(loadFinalMessageCache)
      React.useEffect(() => {
        if (typeof localStorage === 'undefined') return
        try { localStorage.setItem(FINAL_CACHE_KEY, serializeFinalMessageCache(finalStates)) } catch {}
      }, [finalStates])
      const finalRequests = tasks.filter((task) => {
        if (task.session.status !== 'idle' || expanded[`${task.id}:final`] !== true) return false
        const cached = finalStates[task.id]
        return cached?.status !== 'ready' || cached.updatedAt !== task.updatedAt
      }).map((task) => ({ id: task.id, updatedAt: task.updatedAt }))
      const finalRequestKey = finalRequests.map((request) => `${request.id}:${request.updatedAt}`).join('|')
      const [finalRetry, setFinalRetry] = React.useState(0)
      React.useEffect(() => {
        if (finalRequests.length === 0) return undefined
        let disposed = false
        const controllers = finalRequests.map((request) => ({ request, controller: new AbortController() }))
        setFinalStates((current) => {
          const next = { ...current }
          for (const { request } of controllers) next[request.id] = { status: 'loading', updatedAt: request.updatedAt }
          return next
        })
        for (const { request, controller } of controllers) {
          fetch(`/api/better-tasks/final-message?sessionId=${encodeURIComponent(request.id)}`, { cache: 'no-store', signal: controller.signal })
            .then(async (response) => {
              const body = await response.json()
              if (!response.ok) throw new Error(body?.message ?? body?.code ?? `HTTP ${response.status}`)
              return body
            })
            .then((value) => {
              if (disposed) return
              setFinalStates((current) => current[request.id]?.updatedAt === request.updatedAt ? { ...current, [request.id]: { status: 'ready', updatedAt: request.updatedAt, value } } : current)
            })
            .catch((error) => {
              if (disposed || error?.name === 'AbortError') return
              setFinalStates((current) => current[request.id]?.updatedAt === request.updatedAt ? { ...current, [request.id]: { status: 'error', updatedAt: request.updatedAt, message: String(error?.message ?? error) } } : current)
            })
        }
        return () => {
          disposed = true
          for (const { controller } of controllers) controller.abort()
        }
      }, [finalRequestKey, finalRetry])
      const workspaceBySession = indexWorkspacesBySession(workspaces.items)
      const appearanceByWorkspace = new Map(appearanceState.items.map((item) => [item.workspaceId, item]))
      const iconByKey = new Map(appearanceState.icons.map((icon) => [icon.key, icon]))
      const editingWorkspace = workspaces.items.find((workspace) => workspace.workspaceId === editingWorkspaceId)
      const pendingMoves = new Set(taskPins.pendingSessionIds)
      const now = Date.now()
      const toggleProjection = (sessionId, key) => {
        const disclosureKey = `${sessionId}:${key}`
        setExpanded((current) => {
          if (current[disclosureKey] !== true) return { ...current, [disclosureKey]: true }
          const next = { ...current }
          delete next[disclosureKey]
          return next
        })
      }
      const commitDrop = (overId, half) => {
        if (drag === null) return
        const sessionId = drag.sessionId
        const beforeSessionId = beforeIdForTaskDrop(taskIds, overId, half)
        setDrag(null)
        if (beforeSessionId === sessionId) return
        setMoveError('')
        moveTaskBefore(sessionId, beforeSessionId).catch((error) => setMoveError(String(error?.message ?? error)))
      }

      return element('section', { className: 'dbt-task-view', 'aria-label': t('view.tasks') },
        appearanceState.status === 'unavailable' ? element('div', { className: 'dbt-task-warning', role: 'status' }, t('tasks.appearanceUnavailable')) : null,
        taskPins.error !== null || moveError !== '' ? element('div', { className: 'dbt-task-warning', role: 'status' }, moveError || taskPins.error) : null,
        tasks.length === 0 ? element('div', { className: 'dbt-task-empty' }, t('tasks.empty')) :
          element('div', {
            className: 'dbt-task-list',
            'data-columns': twoColumns ? '2' : '1',
            onDragOver: (event) => {
              if (drag === null || event.target !== event.currentTarget) return
              event.preventDefault()
              const lastId = taskIds.at(-1)
              if (lastId !== undefined && (drag.overId !== lastId || drag.half !== 'after')) setDrag({ ...drag, overId: lastId, half: 'after' })
            },
            onDrop: (event) => {
              if (drag === null || event.target !== event.currentTarget) return
              event.preventDefault()
              const lastId = taskIds.at(-1)
              if (lastId !== undefined) commitDrop(lastId, 'after')
            },
          }, ...((cards) => twoColumns ? [
            element('div', { key: 'column-even', className: 'dbt-task-column', 'data-column': 'even' }, ...cards.filter((_, index) => index % 2 === 0)),
            element('div', { key: 'column-odd', className: 'dbt-task-column', 'data-column': 'odd' }, ...cards.filter((_, index) => index % 2 === 1)),
          ] : cards)(tasks.map((task) => {
            const workspace = workspaceBySession.get(task.id)
            const projectName = workspace?.title ?? task.cwd ?? t('tasks.unknown')
            const appearance = workspace === undefined ? undefined : appearanceByWorkspace.get(workspace.workspaceId)
            const icon = appearance === undefined ? undefined : iconByKey.get(appearance.iconKey)
            const iconColor = COLOR_HEX[appearance?.colorKey] ?? 'var(--dsw-alias-label-secondary)'
            const goalAvailable = task.goal.availability === 'ready'
            const todoAvailable = task.todos.availability === 'ready'
            const todoVisible = !todoAvailable || task.todos.total > 0
            const goalExpanded = goalAvailable && expanded[`${task.id}:goal`] === true
            const todoExpanded = todoAvailable && task.todos.total > 0 && expanded[`${task.id}:todo`] === true
            const finalExpanded = task.session.status === 'idle' && expanded[`${task.id}:final`] === true
            const finalState = finalStates[task.id]
            const pendingInteraction = pendingInteractions.get(task.id)
            const questionElement = pendingInteraction?.kind === 'question' || pendingInteraction?.kind === 'plan-review' ? renderQuestion(pendingInteraction) : null
            const goalLabel = task.goal.availability === 'ready' ? `${task.goal.phase}: ${task.goal.objective}` : availabilityLabel(task.goal, t)
            const todoLabel = task.todos.availability === 'ready' ? `${task.todos.completed}/${task.todos.total}` : availabilityLabel(task.todos, t)
            const stateLabel = task.session.status === 'block' ? t('tasks.blockAria') : task.session.status === 'running' ? t('tasks.runningAria') : t('tasks.idleAria')
            const dropHalf = drag?.overId === task.id ? drag.half : undefined
            const detailRows = []
            if (goalExpanded) detailRows.push(element('div', {
              key: 'goal',
              className: 'dbt-projection-detail',
              'data-tone': task.goal.phase ?? task.goal.availability,
              title: goalLabel,
              'aria-label': `${t('tasks.goal')}: ${goalLabel}`,
            },
            element(IconGoalOutline16, { size: 14 }),
            element('div', { className: 'dbt-projection-copy' }, task.goal.availability === 'ready' ?
              element(React.Fragment, null,
                element('div', null, task.goal.objective),
                task.goal.blockedReason === undefined ? null : element('div', { title: task.goal.blockedReason.code }, task.goal.blockedReason.message)) :
              availabilityLabel(task.goal, t))))
            if (todoExpanded) detailRows.push(element('div', {
              key: 'todo',
              className: 'dbt-projection-detail',
              title: todoLabel,
              'aria-label': `${t('tasks.todo')}: ${todoLabel}`,
            },
            element(IconChecklistOutline14, { size: 14 }),
            element('div', { className: 'dbt-projection-copy' }, task.todos.availability === 'ready' ?
              element('ul', { className: 'dbt-todo-list' }, ...task.todos.items.map((todo, index) => element('li', {
                key: `${index}:${todo.content}`,
                className: 'dbt-todo-item',
                title: todo.status,
              },
              element('span', { 'aria-hidden': 'true' }, todo.status === 'completed' ? element(IconCheckOutline14, { size: 14 }) : todo.status === 'in_progress' ? element(StateDot, { state: 'ongoing' }) : element(IconClockOutline16, { size: 14 })),
              element('span', null, todo.content)))) : availabilityLabel(task.todos, t))))
            if (finalExpanded) {
              let finalContent
              if (finalState === undefined || finalState.status === 'loading') {
                finalContent = t('tasks.finalLoading')
              } else if (finalState.status === 'error') {
                finalContent = element(React.Fragment, null,
                  element('div', null, t('tasks.finalError')),
                  element('button', {
                    type: 'button',
                    className: 'dbt-final-retry',
                    'data-no-card-drag': true,
                    draggable: false,
                    title: finalState.message,
                    onClick: () => setFinalRetry((value) => value + 1),
                  }, t('tasks.finalRetry')))
              } else if (finalState.value.final === null) {
                finalContent = t('tasks.finalNone')
              } else {
                finalContent = element(React.Fragment, null,
                  element('div', { className: 'dbt-final-copy' }, finalState.value.final.text),
                  finalState.value.truncated ? element('div', { className: 'dbt-final-meta' }, `${t('tasks.finalTruncated')} · ${finalState.value.totalCodePoints}`) : null)
              }
              detailRows.push(element('div', {
                key: 'final',
                className: 'dbt-projection-detail dbt-final-detail',
                'data-tone': finalState?.status ?? 'loading',
                'aria-label': t('tasks.final'),
              }, element('div', { className: 'dbt-projection-copy' }, finalContent)))
            }
            return element('article', {
              key: task.id,
              className: 'dbt-task-card',
              'data-session-id': task.id,
              'data-current': String(task.current),
              'data-state': task.session.status,
              'data-drop': dropHalf,
              'aria-label': `${projectName}: ${stateLabel}`,
              title: stateLabel,
              tabIndex: 0,
              draggable: !pendingMoves.has(task.id),
              onKeyDown: (event) => {
                if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
                event.preventDefault()
                openSession(task.id)
              },
              onClick: (event) => {
                if (event.target?.closest?.('[data-no-card-drag]') || dragClickGuard.current === task.id) return
                openSession(task.id)
              },
              onDragStart: (event) => {
                if (event.target?.closest?.('[data-no-card-drag]')) {
                  event.preventDefault()
                  return
                }
                dragClickGuard.current = task.id
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', task.id)
                setDrag({ sessionId: task.id, overId: task.id, half: 'before' })
              },
              onDragEnd: () => {
                setDrag(null)
                window.setTimeout(() => { if (dragClickGuard.current === task.id) dragClickGuard.current = null }, 0)
              },
              onDragOver: (event) => {
                if (drag === null) return
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                const half = twoColumns ? (event.clientX < rect.left + rect.width / 2 ? 'before' : 'after') : (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
                if (drag.overId !== task.id || drag.half !== half) setDrag({ ...drag, overId: task.id, half })
              },
              onDrop: (event) => {
                event.preventDefault()
                if (drag !== null) commitDrop(task.id, drag.overId === task.id ? drag.half : 'before')
              },
            },
            element('div', { className: 'dbt-task-title-row' },
              element('button', {
                type: 'button',
                className: 'dbt-project-icon',
                style: { color: iconColor },
                'data-no-card-drag': true,
                draggable: false,
                disabled: workspace === undefined || appearanceState.status !== 'ready',
                title: t('tasks.editAppearance'),
                'aria-label': t('tasks.editAppearance'),
                onClick: () => setEditingWorkspaceId(workspace?.workspaceId ?? null),
              }, renderCatalogIcon(icon, 18)),
              element('button', { type: 'button', className: 'dbt-task-open' },
                element('span', { className: 'dbt-task-project' }, projectName),
                element('span', { className: 'dbt-task-session-line' },
                  task.session.status === 'running' ? element(StateDot, { state: 'ongoing' }) : null,
                  element('span', { className: 'dbt-task-title' }, task.title),
                  element('span', { className: 'dbt-task-time' }, compactRelativeTime(task.updatedAt, now, t, relativeTime)))),
              element('button', {
                type: 'button',
                className: 'dbt-task-unpin',
                'data-no-card-drag': true,
                draggable: false,
                disabled: pendingMoves.has(task.id),
                title: t('tasks.unpin'),
                'aria-label': t('tasks.unpin'),
                'aria-pressed': true,
                onDragStart: (event) => event.preventDefault(),
                onClick: () => {
                  setMoveError('')
                  unpinTask(task.id).catch((error) => setMoveError(String(error?.message ?? error)))
                },
              }, renderTaskPinIcon(14))),
            element('div', { className: 'dbt-task-projection-bar' },
              element('button', {
                type: 'button',
                className: 'dbt-projection-toggle',
                'data-no-card-drag': true,
                draggable: false,
                disabled: !goalAvailable,
                'aria-expanded': goalExpanded,
                'aria-label': t(goalExpanded ? 'tasks.collapseGoal' : 'tasks.expandGoal'),
                title: goalLabel,
                onClick: () => { if (goalAvailable) toggleProjection(task.id, 'goal') },
              }, element(IconGoalOutline16, { size: 14 }), element(goalExpanded ? IconChevronDownOutline14 : IconChevronRightOutline14, { size: 14 })),
              todoVisible ? element('button', {
                type: 'button',
                className: 'dbt-projection-toggle',
                'data-no-card-drag': true,
                draggable: false,
                disabled: !todoAvailable,
                'aria-expanded': todoExpanded,
                'aria-label': t(todoExpanded ? 'tasks.collapseTodo' : 'tasks.expandTodo'),
                title: todoLabel,
                onClick: () => { if (todoAvailable) toggleProjection(task.id, 'todo') },
              }, element(IconChecklistOutline14, { size: 14 }), todoAvailable ? element('span', { className: 'dbt-todo-count' }, todoLabel) : null, element(todoExpanded ? IconChevronDownOutline14 : IconChevronRightOutline14, { size: 14 })) : null,
              task.session.status !== 'idle' ? null : element('button', {
                type: 'button',
                className: 'dbt-projection-toggle',
                'data-no-card-drag': true,
                draggable: false,
                'aria-expanded': finalExpanded,
                'aria-label': t(finalExpanded ? 'tasks.collapseFinal' : 'tasks.expandFinal'),
                title: t('tasks.final'),
                onClick: () => toggleProjection(task.id, 'final'),
              }, element(IconSparkle16, { size: 14 }), element(finalExpanded ? IconChevronDownOutline14 : IconChevronRightOutline14, { size: 14 }))),
            detailRows.length === 0 ? null : element('div', { className: 'dbt-projection-details' }, ...detailRows),
            questionElement === null ? null : element('div', {
              className: 'dbt-question-surface',
              'data-no-card-drag': true,
              draggable: false,
              onDragStart: (event) => event.preventDefault(),
            }, questionElement))
          }))),
        editingWorkspace !== undefined ? element(AppearanceDialog, {
          workspace: editingWorkspace,
          appearance: appearanceByWorkspace.get(editingWorkspace.workspaceId),
          appearanceState,
          onClose: () => setEditingWorkspaceId(null),
          t,
        }) : null)
    }

    function SidebarRegion({ wide, collapsed, view, setView, twoColumns, toggleSidebar, renderSlot, useSessions, useWorkspaces, useSessionPendingInteraction, useTaskPins, openSession, moveTaskBefore, unpinTask, renderQuestion, t }) {
      if (!wide) {
        return renderSlot('sidebar.workspaces', { wide: false, expandSidebar: () => { if (collapsed) toggleSidebar() } })
      }
      return element('div', { className: 'dbt-region-shell' },
        element('div', { className: 'dbt-view-tabs', role: 'tablist', 'aria-label': 'Sidebar view' },
          element('button', { type: 'button', role: 'tab', className: 'dbt-view-tab', 'aria-selected': view === 'native', onClick: () => setView('native') }, t('view.native')),
          element('button', { type: 'button', role: 'tab', className: 'dbt-view-tab', 'aria-selected': view === 'tasks', onClick: () => setView('tasks') }, t('view.tasks'))),
        element('div', { className: 'dbt-region-panel', role: 'tabpanel' },
          view === 'native' ? renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} }) : element(TaskSwimlane, {
            useSessions,
            useWorkspaces,
            useSessionPendingInteraction,
            useTaskPins,
            openSession,
            moveTaskBefore,
            unpinTask,
            renderQuestion,
            twoColumns,
            t,
          })))
    }

    function PanelRow({ panel, wide, usePanelInfo, selectPanel, renderSlot }) {
      const active = usePanelInfo((info) => info.activePanelId === panel.id)
      return element('button', {
        type: 'button',
        className: 'dbt-panel-row',
        title: wide ? undefined : panel.label,
        'aria-label': panel.label,
        'aria-current': active ? 'page' : undefined,
        onClick: () => selectPanel(panel.id),
      },
      element('span', { className: 'dbt-panel-glyph', 'aria-hidden': 'true' },
        renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, { only: panel.id })),
      wide ? element('span', { className: 'dbt-panel-label' }, panel.label) : null)
    }

    function BetterSidebarRoot({
      collapsed,
      width,
      startSession,
      toggleSidebar,
      selectPanel,
      usePanels,
      usePanelInfo,
      useSessions,
      useWorkspaces,
      useSessionPendingInteraction,
      useTaskPins,
      openSession,
      moveTaskBefore,
      unpinTask,
      renderQuestion,
      t,
      renderSlot,
    }) {
      const React = requireModule('react')
      const { IconPanelLeftOutline16, Tooltip } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
      const [view, setView] = useStoredPreference('dsh-better-tasks.view', 'native', ['native', 'tasks'])
      const panels = usePanels((value) => value)
      const [settled, setSettled] = React.useState(collapsed)
      React.useEffect(() => {
        if (!collapsed) {
          setSettled(false)
          return undefined
        }
        const timer = window.setTimeout(() => setSettled(true), 150)
        return () => window.clearTimeout(timer)
      }, [collapsed])
      const wide = !collapsed || !settled
      const twoColumns = !collapsed && width > TASK_GRID_TWO_COLUMN_THRESHOLD
      const lastWideWidth = React.useRef(width)
      if (!collapsed) lastWideWidth.current = width
      const toggleLabel = collapsed ? t('toggle.open') : t('toggle.collapse')
      const newLabel = t('session.new.label')
      const startNewSession = () => startSession()

      return element('aside', {
        className: 'dbt-sidebar',
        'data-wide': String(wide),
        'data-collapsing': String(collapsed && wide),
        style: wide ? { width: collapsed ? lastWideWidth.current : width } : undefined,
        'aria-label': 'DSH sidebar',
      },
      element('div', { className: 'dbt-brand-row' },
        wide ? element('button', {
          type: 'button',
          className: 'dbt-brand',
          'aria-label': newLabel,
          onClick: startNewSession,
        },
        element('span', { className: 'dbt-brand-mark', 'aria-hidden': 'true' },
          renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: element('span', null, '◆') })),
        element('span', { className: 'dbt-brand-name' },
          renderSlot('sidebar.brand.name', {}, { fallback: element('span', null, t('brand.fallback')) }))) : null,
        element(Tooltip, {
          label: toggleLabel,
          delayMs: 500,
          children: element('button', {
            type: 'button',
            className: 'dbt-icon-button dbt-toggle',
            'aria-label': toggleLabel,
            onClick: toggleSidebar,
          },
          !wide ? element('span', { className: 'dbt-rail-mark', 'aria-hidden': 'true' },
            renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: element('span', null, '◆') })) : null,
          element(IconPanelLeftOutline16, { className: 'dbt-panel-icon', size: wide ? 16 : 18 }))
        })), 
      element('button', {
        type: 'button',
        className: 'dbt-new-session',
        title: wide ? undefined : newLabel,
        'aria-label': newLabel,
        onClick: startNewSession,
      },
      element('span', { 'aria-hidden': 'true' }, '＋'),
      wide ? element('span', { className: 'dbt-new-label' }, t('session.new')) : null),
      panels.length > 0 ? element('nav', { className: 'dbt-panel-list', 'aria-label': t('panels.label') },
        ...panels.map((panel) => element(PanelRow, {
          key: panel.id,
          panel,
          wide,
          usePanelInfo,
          selectPanel,
          renderSlot,
        }))) : null,
      element('div', { className: 'dbt-workspaces' },
        element(SidebarRegion, {
          wide,
          collapsed,
          view,
          setView,
          twoColumns,
          toggleSidebar,
          renderSlot,
          useSessions,
          useWorkspaces,
          useSessionPendingInteraction,
          useTaskPins,
          openSession,
          moveTaskBefore,
          unpinTask,
          renderQuestion,
          t,
        })),
      element('div', { className: 'dbt-foot' },
        element('div', { className: 'dbt-footer-actions' }, renderSlot('sidebar.footer.action', { wide })),
        element('div', { className: 'dbt-settings' }, renderSlot('sidebar.settings', { wide }))))
    }

    function mountSidebar(ctx, taskPins) {
      ctx.effect(() => installStyles(), 'dsh-better-tasks: styles')
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-better-tasks: dictionaries')
      ctx.effect(() => ctx.uiWorkspace.onSessionCreated((sessionId) => taskPins.pinCreated(sessionId)), 'dsh-better-tasks: auto-pin created sessions')

      const panels = createSnapshotStore([])
      const syncPanels = () => {
        const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }, index) => ({
          id: options.id,
          order: options.order ?? 0,
          registrationIndex: index,
          label: resolveLabel(options.label, options.id),
        })).filter((panel) => typeof panel.id === 'string' && panel.id !== '')
          .sort((left, right) => left.order - right.order || left.registrationIndex - right.registrationIndex)
        panels.set(next)
      }

      ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'dsh-better-tasks: panel entries')
      ctx.effect(() => ctx.locale.subscribe(syncPanels), 'dsh-better-tasks: panel labels')

      const injectProps = () => ({
        startSession: (workspaceId, beforeOpen) => ctx.uiWorkspace.startSession(workspaceId, beforeOpen),
        toggleSidebar: () => ctx.layout.toggleSidebar(),
        selectPanel: (panelId) => ctx.layout.selectPanel(panelId),
        openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
        moveTaskBefore: (sessionId, beforeSessionId) => taskPins.moveBefore(sessionId, beforeSessionId),
        unpinTask: (sessionId) => taskPins.setPinned(sessionId, false),
        // Optional by design: native packages without the public surface keep the
        // canonical Composer and never hold the rest of the UI in a waiting state.
        renderQuestion: (pending) => ctx.get('questionSurface')?.render(pending, 'task-card') ?? null,
        hooks: { panels, taskPins: taskPins.source },
      })

      ctx.slots.inject('sidebar', () => ctx.slots.register({
        name: 'sidebar',
        locale: NS,
        children: createSidebarChildDeclarations(),
        inject: injectProps,
      }, BetterSidebarRoot))

      syncPanels()
    }

    function apply(ctx) {
      const taskPins = createTaskPinsClient()
      ctx.provide('betterTaskPins', taskPins)
      ctx.effect(() => taskPins.start(), 'dsh-better-tasks: pin projection')
      ctx.inject(['uiWorkspace'], (scope) => mountSidebar(scope, taskPins))
    }

    const contract = Object.freeze({
      activityRanges: ACTIVITY_RANGE_DAYS,
      childSlots: SIDEBAR_CHILD_SLOTS,
      beforeIdForTaskDrop,
      createSidebarChildDeclarations,
      derivePinnedTasks,
      deriveRecentTasks,
      indexWorkspacesBySession,
      loadProjectAppearances,
      summarizeGoal,
      summarizeSession,
      summarizeTodos,
    })

    return { name, inject, apply, contract }
  },
})
