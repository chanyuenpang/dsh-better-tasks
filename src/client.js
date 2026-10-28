import {
  ACTIVITY_RANGE_DAYS,
  SIDEBAR_CHILD_SLOTS,
  beforeIdForTaskDrop,
  createSidebarChildDeclarations,
  derivePinnedTasks,
  deriveRecentTasks,
  indexWorkspacesBySession,
  loadProjectAppearances,
  summarizeGoal,
  summarizeSession,
  summarizeTodos,
  taskExecutionWarning,
} from './task-model.mjs'
import { createTaskPinsClient } from './pin-client.mjs'
import { createTaskInputManager } from './task-input-surface.mjs'
import { TASK_SETTINGS_NAMESPACE, TASK_SETTINGS_ENTRY_ID, createTaskPreferencesStore } from './task-preferences.mjs'

export const name = 'dsh-better-tasks'
// The shared question surface is optional: older/native question packages keep
// their composer behavior without delaying sidebar, Session, or Workspace startup.
export const inject = ['slots', 'layout', 'locale']

const NS = 'better-tasks-sidebar'
const STYLE_ID = 'dsh-better-tasks/sidebar'
const TASK_GRID_TWO_COLUMN_THRESHOLD = 528
const FINAL_CACHE_KEY = 'dsh-better-tasks.final-message-cache.v1'
/**
 * Build revision, injected by scripts/build-client.mjs as the sha256 of this
 * plugin's client-side sources. Every render-probe payload carries it: the
 * browser's localStorage is an append log, so records from earlier builds stay
 * forever and only payloads whose revision matches the delivered build count.
 */
const BUILD_REVISION = '__BUILD_REVISION__'
/** Render probe: on by default, so a delivered build can prove the column rendered. */
const RENDER_PROBE = true
/** Per-render payload; rewritten on every invocation. */
const RENDER_PROBE_KEY = 'dbt-render-probe'
/** One-shot environment facts for the same build. */
const RENDER_ENV_KEY = 'dbt-render-env'
/** Cumulative call-mix ledger; survives the per-frame payload being overwritten. */
const RENDER_LEDGER_KEY = 'dbt-render-ledger'
/** The inner component's own throw, captured in the same fiber before it escapes. */
const RENDER_ERROR_KEY = 'dbt-render-error'
/** The view this plugin kept in localStorage before D1 moved it to the Config. */
const LEGACY_VIEW_KEY = 'dsh-better-tasks.view'
/** Set once the legacy localStorage view has been folded into the preference. */
const VIEW_MIGRATED_KEY = 'dsh-better-tasks.view-migrated'

let renderProbeCount = 0
let renderBareCount = 0
let renderReactCount = 0
let firstBareStack = null

/** Diagnostics must never break a render. */
function writeStorage(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

/**
 * Capture the call site of a bare invocation.
 *
 * Taken while this frame is still the top of the stack, so the frames above it are
 * the caller's. This is the only way to name the path that invokes the registered
 * component outside React.
 * @returns the first 25 frames, truncated to 1500 characters.
 */
function captureCallStack() {
  try {
    return String(new Error().stack ?? '').split('\n').slice(0, 25).join('\n').slice(0, 1500)
  } catch {
    return ''
  }
}

/**
 * Write one render-probe payload. Called at the very top of the guarded root,
 * BEFORE any dry-run short circuit: a guard that returns first would hide the
 * bare call this probe exists to observe, and the A/B question would stay
 * unanswered forever while looking like "did not crash".
 * @param input - the frame's observations.
 */
function writeRenderProbe(input) {
  renderProbeCount += 1
  if (input.zeroArg) renderBareCount += 1
  if (input.hookOk && !input.zeroArg) renderReactCount += 1
  if (input.zeroArg && firstBareStack === null) firstBareStack = input.stack ?? ''
  const via = input.zeroArg && !input.hookOk ? 'bare' : (input.hookOk ? 'react' : 'unknown')
  writeStorage(RENDER_PROBE_KEY, JSON.stringify({
    revision: BUILD_REVISION,
    rendered: renderProbeCount,
    zeroArg: input.zeroArg,
    isElement: input.isElement,
    propKeys: input.propKeys,
    durationMs: input.durationMs,
    // The A/B criterion itself: a hook is legal here only on a React render
    // stack, so a failed probe means this call site is not React rendering.
    hookOk: input.hookOk,
    via,
    zeroArgCount: renderBareCount,
    // Only on a bare call, and only from the true call site.
    ...(input.zeroArg ? { stack: input.stack ?? '' } : {}),
  }))
  // One overwritten key cannot show a MIX of callers: the last frame wins, so
  // "all six were bare" and "five bare then one React render" look identical.
  // The ledger keeps the totals, making `react: 0` a provable fact.
  writeRenderLedger()
}

/**
 * Rewrite the cumulative ledger. Shared by the per-frame probe and the inner
 * component's throw capture, so the error count is visible in the same record.
 */
function writeRenderLedger() {
  writeStorage(RENDER_LEDGER_KEY, JSON.stringify({
    revision: BUILD_REVISION,
    total: renderProbeCount,
    react: renderReactCount,
    bare: renderBareCount,
    zeroArgCount: renderBareCount,
    firstBareStack,
  }))
}
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
    'tasks.todoCompleted': '已完成',
    'tasks.todoInProgress': '进行中',
    'tasks.todoPending': '待处理',
    'tasks.empty': '还没有置顶会话',
    'tasks.pinMigration': '正在合并已有置顶任务…',
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
    'tasks.copyCode': '复制代码',
    'tasks.copiedCode': '已复制',
    'tasks.footnotes': '脚注',
    'tasks.unpin': '从任务中移除',
    'tasks.continue': '继续任务',
    'tasks.continueDefault': '继续',
    'tasks.inputLoading': '正在打开输入框…',
    'tasks.inputSearch': '搜索技能或指令…',
    'tasks.inputEmpty': '未找到匹配的技能或指令',
    'tasks.inputCatalogError': '部分项目加载失败，请收起后重试',
    'tasks.retryInput': '重试',
    'tasks.expandInput': '展开续行输入栏',
    'tasks.collapseInput': '收起续行输入栏',
    'tasks.goalResumeWarning': '消息已发送，但 Goal 恢复失败',
    'tasks.send': '发送',
    'tasks.add': '添加',
    'tasks.skillSearch': '搜索技能',
    'tasks.skillLoading': '正在加载…',
    'tasks.skillEmpty': '没有匹配的技能',
    'tasks.skillUnavailable': '技能列表暂不可用',
    'tasks.rename': '重命名会话',
    'tasks.renameAction': '重命名',
    'tasks.actionUnavailable': '当前会话状态已变化，请重试',
    'tasks.runningAria': '运行中',
    'tasks.blockAria': '等待交互',
  'tasks.answer': '去回答',
  'tasks.questionLoading': '正在加载问题选项…',
  'tasks.answerHint': '打开该会话的问题面板',
  'tasks.answerFailed': '没能打开问题面板，请打开会话作答',
    'tasks.idleAria': '空闲',
    'tasks.execution.disconnected': '连接已断开 · 任务状态未知',
    'tasks.execution.error': '执行失败',
    'tasks.execution.aborted': '执行已停止',
    'tasks.execution.interrupted': '执行已中断',
    'tasks.execution.max-tokens': '执行已中断 · 达到输出上限',
    'tasks.appearanceUnavailable': '项目外观暂不可用',
    'tasks.unknown': '未知',
    'tasks.none': '无',
    'tasks.editAppearance': '设置项目图标和颜色',
    'tasks.appearanceTitle': '项目外观',
    'tasks.iconSearch': '搜索图标',
    'tasks.cancel': '取消',
    'tasks.save': '保存',
    'settings.nav': '任务视图',
    'settings.title': '任务视图',
    'settings.description': '自定义任务卡投影的显示方式。修改会立即生效。',
    'settings.fontSize': '详情正文字号',
    'settings.fontSizeHint': '影响 Todo、Goal、Final 的展开正文及任务卡问题区。',
    'settings.titleEmphasis': '任务卡名称强调',
    'settings.titleEmphasis.project': '强调项目名',
    'settings.titleEmphasis.task': '强调任务名',
    'settings.titleEmphasisHint': '仅调整项目名与任务名的字号、字重和主次色。',
    'settings.defaultExpansion': '默认展开',
    'settings.todoExpanded': 'Todo',
    'settings.goalExpanded': 'Goal',
    'settings.finalExpanded': 'Final',
    'settings.inputExpanded': '快速消息栏',
    'settings.expansionHint': '默认值适用于未手动调整的内容。Goal 换目标、Todo 换目标或清单内容、Final 和快速消息栏进入新空闲周期时恢复默认；仅进度变化不重置 Todo。当前正在浏览的任务进入新空闲周期时不自动展开 Final；手动展开仍有效。快速消息栏仅在空闲卡片的 Final 展开时显示。',
    'settings.columns': '任务列布局',
    'settings.columns.auto': '自动',
    'settings.columns.single': '单列',
    'settings.columns.double': '双列',
    'settings.columnsHint': '自动模式在侧边栏宽度大于 528px 时使用双列。',
    'settings.loading': '正在读取设置…',
    'settings.unavailable': '设置暂不可用，当前使用默认值。',
    'settings.readOnly': '当前连接只读。',
    'settings.writeFailed': '保存失败，已恢复 Host 设置。',
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
    'tasks.todoCompleted': 'Completed',
    'tasks.todoInProgress': 'In progress',
    'tasks.todoPending': 'Pending',
    'tasks.empty': 'No pinned sessions yet',
    'tasks.pinMigration': 'Importing existing pinned tasks…',
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
    'tasks.copyCode': 'Copy code',
    'tasks.copiedCode': 'Copied',
    'tasks.footnotes': 'Footnotes',
    'tasks.unpin': 'Unpin task',
    'tasks.continue': 'Continue task',
    'tasks.continueDefault': 'Continue',
    'tasks.inputLoading': 'Opening input…',
    'tasks.inputSearch': 'Search skills or commands…',
    'tasks.inputEmpty': 'No matching skills or commands',
    'tasks.inputCatalogError': 'Some items could not load. Close and reopen to retry.',
    'tasks.retryInput': 'Retry',
    'tasks.expandInput': 'Expand follow-up input',
    'tasks.collapseInput': 'Collapse follow-up input',
    'tasks.goalResumeWarning': 'Message sent, but Goal resume failed',
    'tasks.send': 'Send',
    'tasks.add': 'Add',
    'tasks.skillSearch': 'Search skills',
    'tasks.skillLoading': 'Loading…',
    'tasks.skillEmpty': 'No matching skills',
    'tasks.skillUnavailable': 'Skills are unavailable',
    'tasks.rename': 'Rename session',
    'tasks.renameAction': 'Rename',
    'tasks.actionUnavailable': 'Session state changed; please try again',
    'tasks.runningAria': 'Running',
    'tasks.blockAria': 'Waiting for interaction',
  'tasks.answer': 'Go answer',
  'tasks.questionLoading': 'Loading question options…',
  'tasks.answerHint': 'Open this Session’s question panel',
  'tasks.answerFailed': 'Could not open the question panel — open the Session to answer',
    'tasks.idleAria': 'Idle',
    'tasks.execution.disconnected': 'Connection lost · task status unknown',
    'tasks.execution.error': 'Execution failed',
    'tasks.execution.aborted': 'Execution stopped',
    'tasks.execution.interrupted': 'Execution interrupted',
    'tasks.execution.max-tokens': 'Execution stopped · token limit reached',
    'tasks.appearanceUnavailable': 'Project appearance is unavailable',
    'tasks.unknown': 'Unknown',
    'tasks.none': 'None',
    'tasks.editAppearance': 'Set project icon and color',
    'tasks.appearanceTitle': 'Project appearance',
    'tasks.iconSearch': 'Search icons',
    'tasks.cancel': 'Cancel',
    'tasks.save': 'Save',
    'settings.nav': 'Task View',
    'settings.title': 'Task View',
    'settings.description': 'Customize how task-card projections are displayed. Changes apply immediately.',
    'settings.fontSize': 'Detail text size',
    'settings.fontSizeHint': 'Affects expanded Todo, Goal, and Final text, plus task-card questions.',
    'settings.titleEmphasis': 'Task card name emphasis',
    'settings.titleEmphasis.project': 'Emphasize project',
    'settings.titleEmphasis.task': 'Emphasize task',
    'settings.titleEmphasisHint': 'Changes only the project and task name size, weight, and color.',
    'settings.defaultExpansion': 'Default expansion',
    'settings.todoExpanded': 'Todo',
    'settings.goalExpanded': 'Goal',
    'settings.finalExpanded': 'Final',
    'settings.inputExpanded': 'Quick message bar',
    'settings.expansionHint': 'Defaults apply where no manual choice exists. Goal resets for a new goal; Todo for a new goal or list contents; Final and the quick message bar for a new idle cycle. Progress-only changes keep Todo choices. The currently browsed task does not automatically open Final for a new idle cycle; manual opening still works. The quick message bar appears only on idle cards with Final expanded.',
    'settings.columns': 'Task columns',
    'settings.columns.auto': 'Auto',
    'settings.columns.single': 'Single',
    'settings.columns.double': 'Double',
    'settings.columnsHint': 'Auto uses two columns when the sidebar is wider than 528px.',
    'settings.loading': 'Loading settings…',
    'settings.unavailable': 'Settings are unavailable; defaults are active.',
    'settings.readOnly': 'This connection is read-only.',
    'settings.writeFailed': 'Save failed; Host settings were restored.',
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
/* Desktop collapses this column to zero, not to the browser's icon rail.
   Match the native sidebar's Windows caption affordances instead of changing
   the layout owner or forcing a phantom rail width. */
html[data-windows-titlebar] .dbt-sidebar .dbt-toggle{position:fixed;top:calc((var(--dsh-windows-titlebar-height) - 28px) / 2);left:12px;z-index:30;width:28px;height:28px;-webkit-app-region:no-drag}
html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-brand-row{height:0}
html[data-windows-titlebar] .dbt-sidebar[data-wide="false"]{padding:0}
html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-toggle .dbt-panel-icon{display:inline}
html[data-windows-titlebar] .dbt-sidebar .dbt-toggle .dbt-rail-mark{display:none}
html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-new-session{position:fixed;top:calc((var(--dsh-windows-titlebar-height) - 28px) / 2);left:48px;z-index:30;width:28px;height:28px;margin:0;padding:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);-webkit-app-region:no-drag}
html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-new-session:hover{background:var(--dsw-alias-interactive-bg-hover)}
html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-panel-list,html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-workspaces,html[data-windows-titlebar] .dbt-sidebar[data-wide="false"] .dbt-foot{display:none}
html[data-windows-titlebar]:has(.dbt-sidebar[data-wide="false"]){--dsh-windows-menu-start:84px}
.dbt-shell-leading{display:flex;align-items:center;gap:8px;-webkit-app-region:no-drag}
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
.dbt-task-card{--dbt-task-tone:var(--dsw-alias-label-primary);--dbt-task-bg:var(--dsw-alias-bg-layer-1);--dbt-unpin-color:color-mix(in srgb,var(--dbt-task-bg) 80%,var(--dbt-task-tone));--dbt-task-border:color-mix(in srgb,currentColor 10%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,var(--dsw-alias-label-primary));position:relative;box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dbt-task-border);border-radius:11px;background:var(--dbt-task-bg);padding:9px;display:flex;flex-direction:column;gap:8px;cursor:pointer;box-shadow:none}
.dbt-task-card[data-state="idle"]{--dbt-task-border:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-label-primary) 34%,transparent);--dbt-task-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-state="running"]{--dbt-task-tone:var(--dsw-alias-success,#1f9d62);--dbt-task-border:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 24%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 58%,transparent);--dbt-task-bg:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 12%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-state="block"]{--dbt-block-yellow:#d2aa00;--dbt-task-tone:var(--dbt-block-yellow);--dbt-task-border:color-mix(in srgb,var(--dbt-block-yellow) 34%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dbt-block-yellow) 72%,var(--dsw-alias-label-primary));--dbt-task-bg:color-mix(in srgb,var(--dbt-block-yellow) 18%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-current="true"]{border-color:var(--dbt-task-border-selected);box-shadow:none;--dbt-task-bg:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-current="true"][data-state="running"]{--dbt-task-bg:color-mix(in srgb,var(--dsw-alias-success,#1f9d62) 17%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-current="true"][data-state="block"]{--dbt-task-bg:color-mix(in srgb,var(--dbt-block-yellow) 23%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-execution-warning]{--dbt-task-tone:var(--dsw-alias-state-error-primary);--dbt-task-border:color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,transparent);--dbt-task-border-selected:color-mix(in srgb,var(--dsw-alias-state-error-primary) 58%,transparent);--dbt-task-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,var(--dsw-alias-bg-layer-1))}
.dbt-task-card[data-current="true"][data-execution-warning]{--dbt-task-bg:color-mix(in srgb,var(--dsw-alias-state-error-primary) 17%,var(--dsw-alias-bg-layer-1))}
.dbt-task-error-icon{flex:none;color:var(--dsw-alias-state-error-primary)}
.dbt-task-card[data-drop="before"]:before,.dbt-task-card[data-drop="after"]:after{content:"";position:absolute;z-index:2;left:8px;right:8px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary);pointer-events:none}
.dbt-task-card[data-drop="before"]:before{top:1px}.dbt-task-card[data-drop="after"]:after{bottom:1px}
.dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="before"]:before,.dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="after"]:after{top:8px;bottom:8px;width:2px;height:auto}
.dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="before"]:before{left:1px;right:auto}.dbt-task-list[data-columns="2"] .dbt-task-card[data-drop="after"]:after{left:auto;right:1px}
.dbt-task-title-row{display:flex;align-items:center;gap:7px;min-width:0}
.dbt-task-open{min-width:0;flex:1;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0}
.dbt-task-project{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:680;line-height:19px}
.dbt-task-session-line{display:flex;align-items:center;gap:5px;min-width:0;margin-top:1px}
.dbt-task-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dbt-task-rename{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;text-align:left;cursor:pointer;padding:0}
.dbt-task-list[data-title-emphasis="task"] .dbt-task-project{font-size:11px;font-weight:400;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dbt-task-list[data-title-emphasis="task"] .dbt-task-rename{font-size:14px;font-weight:680;line-height:19px;color:var(--dsw-alias-label-primary)}
.dbt-task-rename:hover{text-decoration:underline;color:var(--dsw-alias-label-primary)}
.dbt-continue-shell,.dbt-continue-form{cursor:text}
.dbt-continue-form{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-soft)}
.dbt-continue-form:focus-within{border-color:var(--dsw-alias-brand-primary)}
.dbt-continue-form .dbt-action-input{min-width:0;min-height:32px;max-height:120px;resize:none;overflow-y:hidden;padding:7px 11px 5px;font-size:12px;line-height:18px;background:transparent;border:0;border-radius:18px 18px 0 0;outline:none}
.dbt-continue-actions{box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;min-height:36px;padding:1px 6px 6px}
.dbt-continue-add{display:grid;place-items:center;flex:none;width:27px;height:27px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dbt-continue-add:hover,.dbt-continue-add[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dbt-continue-add:disabled{opacity:.4;cursor:default}
.dbt-continue-add:focus-visible,.dbt-skill-picker button:focus-visible,.dbt-skill-picker input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dbt-skill-picker{margin:0 7px 4px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);cursor:default}
.dbt-skill-picker input{box-sizing:border-box;width:100%;height:29px;padding:4px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dbt-skill-results{max-height:180px;overflow-y:auto;margin-top:5px;display:flex;flex-direction:column;gap:2px}
.dbt-skill-picker button{min-width:0;display:flex;flex-direction:column;gap:1px;width:100%;padding:5px 7px;border:0;border-radius:6px;text-align:left;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dbt-skill-picker button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbt-skill-picker small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dbt-skill-status{padding:6px;color:var(--dsw-alias-label-secondary);font-size:11px}
.dbt-continue-send{corner-shape:round;flex:none;display:grid;place-items:center;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;transition:background-color .1s}
.dbt-continue-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.dbt-continue-send:disabled{opacity:.4;cursor:default}
.dbt-continue-send:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dbt-continue-error{margin-top:-4px}
.dbt-task-time{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.dbt-project-icon{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;flex:none;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.dbt-project-icon:disabled{cursor:default;opacity:.72}
.dbt-task-unpin{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dbt-unpin-color);cursor:pointer;opacity:0;pointer-events:none;transition:border-color .12s ease}
.dbt-task-unpin svg{width:14px;height:14px;flex:none}
.dbt-task-card:hover .dbt-task-unpin,.dbt-task-card:focus-within .dbt-task-unpin,.dbt-task-unpin:focus-visible{opacity:1;pointer-events:auto}
.dbt-task-unpin:hover{border-color:color-mix(in srgb,var(--dbt-unpin-color) 40%,transparent)}
.dbt-task-unpin:disabled{cursor:default;opacity:.45}
.dbt-task-projection-bar{display:flex;align-items:center;gap:5px}
.dbt-projection-toggle{height:27px;min-width:34px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}
.dbt-projection-toggle:hover,.dbt-projection-toggle[aria-expanded="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dbt-projection-toggle:disabled{cursor:default;opacity:.38;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.dbt-todo-count{font-size:10px;font-variant-numeric:tabular-nums}
.dbt-projection-details{display:flex;flex-direction:column;gap:6px;padding-top:1px}
.dbt-projection-detail{display:grid;grid-template-columns:18px minmax(0,1fr);gap:6px;align-items:start;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,transparent);padding:7px;font-size:var(--dbt-projection-font-size,13px);line-height:1.5}
.dbt-projection-detail.dbt-final-detail{display:block;background:var(--dsw-alias-bg-layer-1);padding:10px;transition:background-color .34s ease}
.dbt-projection-detail.dbt-final-detail[data-feedback="pending"]{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--dsw-alias-bg-layer-1));transition-duration:.22s}
@media (prefers-reduced-motion:reduce){.dbt-projection-detail.dbt-final-detail{transition:none}}
.dbt-final-input-toggle{box-sizing:border-box;width:calc(100% + 6px);margin:-3px;padding:8px;border:1px solid transparent;border-radius:8px;cursor:pointer;outline:none}
.dbt-final-input-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dbt-projection-detail[data-tone="blocked"]{color:var(--dsw-alias-error,#d14343)}
.dbt-projection-copy{min-width:0;overflow-wrap:anywhere}
.dbt-final-copy{min-width:0;overflow-wrap:anywhere}
/* Rebind the consumed Markdown shorthands locally: BODY-derived theme tokens do
   not recompute merely because a descendant changes the content-size input. */
.dbt-final-copy,.dbt-question-surface{--dbt-text-size:var(--dbt-projection-font-size,13px);--dbt-secondary-size:min(calc(var(--dbt-text-size) - 1px),max(13px,calc(var(--dbt-text-size) - 2px)));--dsw-font-markdown-base:400 var(--dbt-text-size)/calc(var(--dbt-text-size) + 10px) var(--dsw-font-family);--dsw-font-markdown-base-strong:600 var(--dbt-text-size)/calc(var(--dbt-text-size) + 10px) var(--dsw-font-family);--dsw-font-markdown-h1:700 calc(var(--dbt-text-size) + 7px)/calc(var(--dbt-text-size) + 16px) var(--dsw-font-family);--dsw-font-markdown-h2:700 calc(var(--dbt-text-size) + 5px)/calc(var(--dbt-text-size) + 14px) var(--dsw-font-family);--dsw-font-markdown-h3:700 calc(var(--dbt-text-size) + 4px)/calc(var(--dbt-text-size) + 12px) var(--dsw-font-family);--dsw-font-markdown-h4:600 var(--dbt-text-size)/calc(var(--dbt-text-size) + 10px) var(--dsw-font-family);--dsw-font-markdown-table:400 var(--dbt-secondary-size)/calc(var(--dbt-secondary-size) + 9px) var(--dsw-font-family);--dsw-font-markdown-table-head:500 var(--dbt-secondary-size)/calc(var(--dbt-secondary-size) + 9px) var(--dsw-font-family);--dsw-font-markdown-code:400 calc(var(--dbt-text-size) * 11 / 14)/calc(var(--dbt-text-size) * 19 / 14) var(--ds-font-family-code);--dsw-font-markdown-code-block:400 calc(var(--dbt-text-size) * 11 / 14)/calc(var(--dbt-text-size) * 19 / 14) var(--ds-font-family-code)}
.dbt-final-copy .md-code-block,.dbt-question-surface .md-code-block{--dsl-code-block-banner-font:400 calc(var(--dbt-text-size) * 11 / 14)/calc(var(--dbt-text-size) * 18 / 14) var(--ds-font-family-code)}
.dbt-final-copy [data-code-block-banner] > :first-child,.dbt-question-surface [data-code-block-banner] > :first-child{font-size:inherit;line-height:inherit}
.dbt-final-copy pre,.dbt-final-copy table{max-width:100%;overflow-x:auto}
.dbt-final-copy img{max-width:100%;height:auto}
.dbt-final-meta{margin-top:5px;color:var(--dsw-alias-label-tertiary);font-size:10px}
.dbt-final-retry{margin-top:5px;border:0;border-radius:6px;padding:3px 7px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);cursor:pointer}
.dbt-question-surface{min-width:0;max-width:100%;overflow:hidden;font-size:var(--dbt-projection-font-size,13px);line-height:1.5}
.dbt-question-notice{padding:6px 8px;color:var(--dsw-alias-warning,#a26900);font:inherit}
.dbt-question-surface *{min-width:0}
.dbt-task-answer{align-self:flex-start;margin:2px 0 0;padding:3px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:var(--dbt-projection-font-size,13px);line-height:1.5;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dbt-block-yellow,#d2aa00) 18%,transparent);border:1px solid color-mix(in srgb,var(--dbt-block-yellow,#d2aa00) 45%,transparent)}
.dbt-task-answer:hover{background:color-mix(in srgb,var(--dbt-block-yellow,#d2aa00) 28%,transparent)}
.dbt-task-answer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dbt-todo-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.dbt-todo-item{display:grid;grid-template-columns:16px minmax(0,1fr);gap:5px;align-items:start}
.dbt-todo-glyph{display:grid;place-items:center;flex:none;width:16px;height:16px}
.dbt-task-empty,.dbt-task-warning{padding:10px;border-radius:9px;font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.dbt-task-warning{padding:6px 8px;color:var(--dsw-alias-warning,#a26900)}
.dbt-dialog-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:color-mix(in srgb,#000 38%,transparent);padding:20px}
.dbt-dialog{width:min(680px,92vw);max-height:min(720px,90vh);overflow:auto;border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px;display:flex;flex-direction:column;gap:12px}
.dbt-dialog h2{font-size:16px;margin:0}
.dbt-dialog input{height:34px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;padding:0 10px}
.dbt-action-input{box-sizing:border-box;width:100%;min-height:92px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:9px 10px;font:inherit}
.dbt-action-input.dbt-rename-input{min-height:44px;height:44px;border:.5px solid var(--dsw-alias-border-l4);border-radius:22px;background:transparent;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px;resize:none}
.dbt-icon-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;max-height:360px;overflow:auto}
.dbt-icon-choice{aspect-ratio:1;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:7px;background:transparent;color:inherit;cursor:pointer;display:grid;place-items:center}
.dbt-icon-choice[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.dbt-color-row{display:flex;flex-wrap:wrap;gap:7px}
.dbt-color-choice{width:25px;height:25px;border-radius:50%;border:2px solid transparent;cursor:pointer}
.dbt-color-choice[data-selected="true"]{outline:2px solid currentColor;outline-offset:2px}
.dbt-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
.dbt-dialog-actions button{height:32px;border:0;border-radius:8px;padding:0 12px;cursor:pointer}
.dbt-dialog-save{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-static-white,#fff)}
.dbt-settings-section{width:min(680px,100%);display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary)}
.dbt-settings-heading{display:flex;flex-direction:column;gap:5px}.dbt-settings-heading h2{margin:0;font-size:18px;line-height:1.3}.dbt-settings-heading p,.dbt-settings-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dbt-settings-group{display:flex;flex-direction:column;gap:10px}.dbt-settings-group-title{font-size:14px;font-weight:650}
.dbt-settings-card{display:flex;flex-direction:column;gap:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px}
.dbt-settings-font-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.dbt-settings-font-options{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px}.dbt-settings-font-option{height:32px;border:0;border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;font-variant-numeric:tabular-nums}.dbt-settings-font-option[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-brand-primary);font-weight:650}.dbt-settings-font-option:disabled{cursor:default;opacity:.5}.dbt-settings-font-value{min-width:44px;text-align:right;font-variant-numeric:tabular-nums;font-weight:650}
.dbt-settings-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:30px}.dbt-settings-switch{position:relative;width:38px;height:22px;flex:none;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-interactive-bg-hover));cursor:pointer;padding:0}.dbt-settings-switch:after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-static-white,#fff);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .14s ease}.dbt-settings-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}.dbt-settings-switch[aria-checked="true"]:after{transform:translateX(16px)}.dbt-settings-switch:disabled{cursor:default;opacity:.5}
.dbt-settings-segments{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.dbt-settings-segments[data-options="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}.dbt-settings-segment{height:32px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.dbt-settings-segment[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.12)}.dbt-settings-segment:disabled{cursor:default;opacity:.5}
.dbt-settings-status{border-radius:8px;padding:8px 10px;font-size:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.dbt-settings-status[data-error="true"]{color:var(--dsw-alias-error,#d14343)}
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
    try {
      const stored = localStorage.getItem(key)
      return stored !== null && allowed.includes(stored) ? stored : fallback
    } catch {
      return fallback
    }
  })
  React.useEffect(() => {
    writeStorage(key, value)
  }, [key, value])
  return [value, setValue]
}

export function isProjectionExpanded(value, key, defaultExpanded) {
  return typeof value[key] === 'boolean' ? value[key] : defaultExpanded
}

/** Native activity is lastPromptAt; cold cache misses may fall back to createdAt. */
export function isNewFinalIdleCycle(cycles, task) {
  if (!Number.isFinite(task.updatedAt) || task.updatedAt < 0) return false
  const consumed = cycles[task.id]
  // A cold/partial/older snapshot is not evidence of another completed cycle.
  // Never lower the persisted watermark and then reset again on hydration.
  return !Number.isFinite(consumed) || task.updatedAt > consumed
}

export function expandFinalForIdleCycles(cycles, idleTasks, value) {
  const nextCycles = { ...cycles }
  const nextExpanded = { ...value }
  let cyclesChanged = false
  let expandedChanged = false
  for (const task of idleTasks) {
    if (!isNewFinalIdleCycle(nextCycles, task)) continue
    nextCycles[task.id] = task.updatedAt
    cyclesChanged = true
    // Consume every new cycle, including the currently browsed Session. Its
    // suppression is remembered so navigation/refresh cannot open it later.
    const finalKey = `${task.id}:final`
    if (task.current === true) {
      // Explicit manual expansion wins; suppress only the automatic default.
      if (nextExpanded[finalKey] !== true && nextExpanded[finalKey] !== false) {
        nextExpanded[finalKey] = false
        expandedChanged = true
      }
    } else if (Object.hasOwn(nextExpanded, finalKey)) {
      delete nextExpanded[finalKey]
      expandedChanged = true
    }
    // Input remains subordinate to Final and starts a new disclosure cycle;
    // neither this reset nor suppression touches drafts, Todo, or Goal.
    const inputKey = `${task.id}:input`
    if (Object.hasOwn(nextExpanded, inputKey)) {
      delete nextExpanded[inputKey]
      expandedChanged = true
    }
  }
  return {
    cycles: cyclesChanged ? nextCycles : cycles,
    expanded: expandedChanged ? nextExpanded : value,
  }
}

export function reconcileGoalExpansionCycles(cycles, goals, endedSessionIds, value) {
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
    if (Object.hasOwn(nextExpanded, key)) {
      delete nextExpanded[key]
      expandedChanged = true
    }
  }
  for (const goal of goals) {
    if (nextCycles[goal.id] === goal.goalId) continue
    nextCycles[goal.id] = goal.goalId
    cyclesChanged = true
    const key = `${goal.id}:goal`
    if (!Object.hasOwn(nextExpanded, key)) continue
    delete nextExpanded[key]
    expandedChanged = true
  }
  return {
    cycles: cyclesChanged ? nextCycles : cycles,
    expanded: expandedChanged ? nextExpanded : value,
  }
}

/** Progress-only changes do not start a new Todo disclosure lifecycle. */
export function todoExpansionCycle(task) {
  if (task.todos.availability === 'unknown' || task.goal.availability === 'unknown') return undefined
  return JSON.stringify([
    task.goal.availability === 'ready' ? task.goal.id : null,
    task.todos.availability === 'ready' ? task.todos.items.map((todo) => todo.content) : null,
  ])
}

export function reconcileTodoExpansionCycles(cycles, tasks, value) {
  const nextCycles = { ...cycles }
  const nextExpanded = { ...value }
  let cyclesChanged = false
  let expandedChanged = false
  for (const task of tasks) {
    const cycle = todoExpansionCycle(task)
    // A temporarily unloaded projection is not the end of its lifecycle.
    if (cycle === undefined || nextCycles[task.id] === cycle) continue
    nextCycles[task.id] = cycle
    cyclesChanged = true
    const key = `${task.id}:todo`
    if (!Object.hasOwn(nextExpanded, key)) continue
    delete nextExpanded[key]
    expandedChanged = true
  }
  return {
    cycles: cyclesChanged ? nextCycles : cycles,
    expanded: expandedChanged ? nextExpanded : value,
  }
}

export function parseFinalMessageCache(raw) {
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

export function serializeFinalMessageCache(states) {
  const ready = Object.entries(states).filter(([, entry]) => entry?.status === 'ready').slice(-100)
  return JSON.stringify(Object.fromEntries(ready))
}

function loadFinalMessageCache() {
  try { return parseFinalMessageCache(localStorage.getItem(FINAL_CACHE_KEY) ?? '') } catch { return {} }
}

function parseExpansionRecord(raw) {
  try {
    const parsed = JSON.parse(raw ?? '{}')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([entryKey, expanded]) => entryKey.length > 0 && typeof expanded === 'boolean').slice(-300))
  } catch {
    return {}
  }
}

// Desktop's dsh-app renderer uses its isolated Electron user-data storage.
// Host Config remains the owner of defaults; this is only per-client disclosure.
// Accessing the localStorage property itself may throw, so guard the entire read.
export function loadStoredExpansion(key, legacyKey) {
  try {
    if (typeof localStorage === 'undefined') return {}
    const current = localStorage.getItem(key)
    if (current !== null) return parseExpansionRecord(current)
    if (legacyKey === undefined) return {}
    const legacy = parseExpansionRecord(localStorage.getItem(legacyKey))
    return Object.fromEntries(Object.entries(legacy).filter(([entryKey, expanded]) => entryKey.endsWith(':todo') && expanded === true))
  } catch {
    return {}
  }
}

function useStoredExpansion(key, legacyKey) {
  const React = requireModule('react')
  const [value, setValue] = React.useState(() => loadStoredExpansion(key, legacyKey))
  React.useEffect(() => {
    writeStorage(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue]
}

function useStoredRecord(key) {
  const React = requireModule('react')
  const [value, setValue] = React.useState(() => {
    try {
      if (typeof localStorage === 'undefined') return {}
      const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      // Keep at least as many cycle markers as bounded disclosure entries; a
      // missing marker must not reset a surviving manual choice on refresh.
      return Object.fromEntries(Object.entries(parsed).filter(([entryKey, cycle]) => entryKey.length > 0 && ['string', 'number'].includes(typeof cycle)).slice(-300))
    } catch {
      return {}
    }
  })
  React.useEffect(() => {
    writeStorage(key, JSON.stringify(value))
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
  if (icon === undefined) return element(requireModule('@deepseek-ai/dsh-client-ui-primitives').IconFolderCloseRegular, { size })
  return element('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, ...icon.nodes.map(([tag, props], index) => element(tag, { ...props, key: `${tag}-${index}` })))
}

/** Resolve verified 0.2 Regular exports lazily; never draw approximate replacement glyphs. */
function nativeIcon(exportName, defaultSize = 14) {
  return function NativeIcon({ size = defaultSize, ...rest }) {
    const Icon = requireModule('@deepseek-ai/dsh-client-ui-primitives')[exportName]
    return element(Icon, { size, ...rest })
  }
}

const IconPanelLeftOutlineRegular = nativeIcon('IconPanelLeftOutlineRegular', 16)
const IconChecklistOutlineRegular = nativeIcon('IconChecklistOutlineRegular')
const IconChevronDownOutlineRegular = nativeIcon('IconChevronDownOutlineRegular')
const IconChevronRightOutlineRegular = nativeIcon('IconChevronRightOutlineRegular')
const IconGoalOutlineRegular = nativeIcon('IconGoalOutlineRegular')
const IconSparkleRegular = nativeIcon('IconSparkleRegular')

function renderOfficialPinIcon(size = 14) {
  const { IconPinFillRegular } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
  return element(IconPinFillRegular, { size })
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

export function resolveTaskContinueText(draft, defaultText) {
  return draft.trim() === '' ? defaultText : draft
}

export function taskContinuePlaceholder(draft, focused, defaultText) {
  return !focused && draft === '' ? defaultText : ''
}

function TaskContinueInput({ sessionId, active, createTaskInput, onWarning, t }) {
  const React = requireModule('react')
  const [activated, setActivated] = React.useState(active)
  const [surface, setSurface] = React.useState(null)
  const [error, setError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)
  const warning = React.useRef(onWarning)
  warning.current = onWarning
  // Hidden, never-opened cards must not open/retain every background Session.
  React.useEffect(() => { if (active) setActivated(true) }, [active])
  React.useEffect(() => {
    if (!activated) return undefined
    const controller = new AbortController()
    let owned
    setSurface(null)
    setError('')
    Promise.resolve().then(() => createTaskInput(sessionId, {
      signal: controller.signal,
      onWarning: (text) => warning.current?.(text),
    })).then((handle) => {
      owned = handle
      if (controller.signal.aborted) handle.dispose()
      else setSurface(handle)
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(String(cause?.message ?? cause))
    })
    return () => { controller.abort(); owned?.dispose() }
  }, [activated, sessionId, createTaskInput, attempt])
  return element('div', { className: 'dbt-continue-host', 'data-no-card-drag': true, draggable: false,
    onDragStart: (event) => event.preventDefault(),
    onClick: (event) => {
      if (event.target?.closest?.('button,a,input,textarea,select,[role="dialog"],[role="listbox"],[role="option"],[data-input-popup],[contenteditable="true"]')) return
      if (active) surface?.input.focus()
    },
  }, surface === null ? (error === ''
    ? activated ? element('div', { role: 'status' }, t('tasks.inputLoading')) : null
    : element('div', { className: 'dbt-task-warning', role: 'alert' }, error,
      element('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, t('tasks.retryInput'))))
    : element(surface.View, {
      className: 'dbt-continue-form', disabled: !active,
      placeholder: t('tasks.continueDefault'), defaultText: t('tasks.continueDefault'), submitLabel: t('tasks.send'),
      inputLabel: t('tasks.continue'), addLabel: t('tasks.add'), searchLabel: t('tasks.inputSearch'),
      emptyLabel: t('tasks.inputEmpty'), errorLabel: t('tasks.inputCatalogError'),
    }))
}

function TaskQuestionCard({ target, createTaskQuestion, fontSize, revealQuestion, canRevealQuestion, t }) {
  const React = requireModule('react')
  const [handle, setHandle] = React.useState(null)
  const [error, setError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    let owned
    setHandle(null); setError('')
    Promise.resolve().then(() => createTaskQuestion({
      sessionId: target.sessionId, requestKey: target.requestKey, callId: target.callId, signal: controller.signal,
    })).then(value => {
      owned = value
      if (controller.signal.aborted) value.dispose()
      else setHandle(value)
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause?.message ?? cause)) })
    return () => { controller.abort(); owned?.dispose() }
  }, [target.sessionId, target.requestKey, target.callId, createTaskQuestion, attempt])
  const fallback = () => typeof target.callId === 'string' && canRevealQuestion()
    ? element('button', { type: 'button', className: 'dbt-task-answer', onClick: event => {
      event.stopPropagation()
      if (revealQuestion(target.sessionId, target.callId) === false) setError(t('tasks.answerFailed'))
    } }, t('tasks.answer')) : null
  if (handle !== null) return element(TaskQuestionView, { handle, fontSize, fallback, t, retry: () => setAttempt(value => value + 1) })
  if (error === '') return element('div', { role: 'status', className: 'dbt-question-notice' }, t('tasks.questionLoading'))
  return element('div', { role: 'alert', className: 'dbt-question-notice' }, error,
    element('button', { type: 'button', className: 'dbt-task-answer', onClick: () => setAttempt(value => value + 1) }, t('tasks.retryInput')), fallback())
}

function TaskQuestionView({ handle, fontSize, fallback, t, retry }) {
  const React = requireModule('react')
  const state = React.useSyncExternalStore(listener => handle.state.subscribe(listener), () => handle.state.getSnapshot())
  if (state.phase === 'closed') return null
  if (state.phase === 'unsupported') return fallback()
  if (state.phase === 'error') return element('div', { className: 'dbt-question-notice', role: 'alert' }, state.message ?? t('tasks.answerFailed'),
    element('button', { type: 'button', className: 'dbt-task-answer', onClick: retry }, t('tasks.retryInput')), fallback())
  if (state.phase === 'waiting') return element('div', { className: 'dbt-question-notice', role: 'status' }, t('tasks.questionLoading'), fallback())
  return element(handle.View, { fontSize })
}

function TaskActionDialog({ action, onClose, onSubmit, t }) {
  const React = requireModule('react')
  const { Modal, Button } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
  const [draft, setDraft] = React.useState(action.title)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const composing = React.useRef(false)
  const selectRenameInput = React.useCallback((node) => {
    if (node === null) return
    node.focus()
    node.select()
  }, [])
  const close = () => { if (!busy) onClose() }
  const submit = async () => {
    if (busy || draft.trim() === '') return
    setBusy(true)
    setError('')
    try { await onSubmit(action, draft); onClose() }
    catch (cause) { setError(String(cause?.message ?? cause)); setBusy(false) }
  }
  const inputProps = {
    className: 'dbt-action-input dbt-rename-input',
    value: draft,
    'aria-label': t('tasks.rename'),
    ref: selectRenameInput,
    disabled: busy,
    onChange: (event) => { setDraft(event.target.value); setError('') },
    onCompositionStart: () => { composing.current = true },
    onCompositionEnd: () => { composing.current = false },
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent?.isComposing) {
        event.preventDefault()
        submit()
      }
    },
  }
  return element(Modal, {
    open: true,
    onClose: close,
    closeLabel: t('tasks.cancel'),
    title: t('tasks.rename'),
    footer: element(React.Fragment, null,
      element(Button, { variant: 'outline', disabled: busy, onClick: close }, t('tasks.cancel')),
      element(Button, { variant: 'primary', disabled: busy || draft.trim() === '', onClick: submit }, t('tasks.renameAction'))),
  },
  element('input', inputProps),
  error === '' ? null : element('div', { className: 'dbt-task-warning', role: 'alert' }, error))
}

export function shouldToggleFinalInput(target) {
  return !target?.closest?.('a')
}

export function isTaskCardFinalShortcutTarget(target) {
  return !target?.closest?.('[data-no-card-drag],button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="switch"]')
}

/** A card gesture reads only the existing bounded, pinned-only Final endpoint. */
export function createCardFinalExpansionController({ getTask, getCached, isExpanded, readFinal, onReady, expand, collapse }) {
  const pending = new Map()
  let disposed = false
  const eligible = (task) => task?.session.status === 'idle'
  const validPayload = (id, value) => value?.sessionId === id &&
    (value.final === null || typeof value.final?.text === 'string')
  const hasFinal = (value) => typeof value.final?.text === 'string' && value.final.text.trim() !== ''
  const cancel = (id) => {
    const request = pending.get(id)
    if (request === undefined) return
    pending.delete(id)
    request.controller.abort()
  }
  const current = (request) => {
    const task = getTask(request.id)
    return !disposed && !request.controller.signal.aborted && pending.get(request.id) === request &&
      eligible(task) && task.updatedAt === request.updatedAt
  }
  return {
    request(id) {
      const task = getTask(id)
      if (disposed || !eligible(task)) return Promise.resolve(false)
      if (isExpanded(id)) {
        // Closing is immediate, even while a preview is loading or failed.
        // Invalidate an older read so its late response cannot reopen Final.
        cancel(id)
        collapse(id)
        return Promise.resolve(true)
      }
      const prior = pending.get(id)
      if (prior?.updatedAt === task.updatedAt) return prior.promise
      cancel(id)
      const cached = getCached(id)
      if (cached?.status === 'ready' && cached.updatedAt === task.updatedAt && validPayload(id, cached.value)) {
        if (!hasFinal(cached.value)) return Promise.resolve(false)
        expand(id)
        return Promise.resolve(true)
      }
      const request = { id, updatedAt: task.updatedAt, controller: new AbortController() }
      pending.set(id, request)
      request.promise = Promise.resolve().then(() => {
        if (!current(request)) return undefined
        return readFinal(request, request.controller.signal)
      }).then((value) => {
        if (!current(request) || !validPayload(id, value)) return false
        onReady(request, value)
        if (!hasFinal(value)) return false
        // This asynchronous path only opens; it never toggles a newer choice.
        expand(id)
        return true
      }).catch(() => false).finally(() => {
        if (pending.get(id) === request) pending.delete(id)
      })
      return request.promise
    },
    cancel,
    reconcile() {
      for (const [id, request] of pending) if (!current(request)) cancel(id)
    },
    dispose() {
      disposed = true
      for (const id of pending.keys()) cancel(id)
    },
  }
}

const FINAL_DOUBLE_CLICK_WAIT_MS = 300

export function createFinalClickController(schedule = (callback, ms) => window.setTimeout(callback, ms), cancelTimer = (timer) => window.clearTimeout(timer), feedback = () => {}) {
  const pending = new Map()
  const cancel = (id) => {
    const timer = pending.get(id)
    if (timer === undefined) return
    cancelTimer(timer)
    pending.delete(id)
    feedback(id, false)
  }
  return {
    click(id, action) {
      const prior = pending.get(id)
      if (prior !== undefined) cancelTimer(prior)
      else feedback(id, true)
      const timer = schedule(() => {
        pending.delete(id)
        feedback(id, false)
        action()
      }, FINAL_DOUBLE_CLICK_WAIT_MS)
      pending.set(id, timer)
    },
    doubleClick(id, action) {
      if (!pending.has(id)) return false
      cancel(id)
      action()
      return true
    },
    cancel,
    dispose() {
      for (const timer of pending.values()) cancelTimer(timer)
      pending.clear()
    },
  }
}

function TaskSwimlane({ useSessions, useWorkspaces, useSessionStatus, useTaskConnection, usePanelInfo, useTaskPins, preferences, openSession, moveTaskBefore, unpinTask, revealQuestion, canRevealQuestion, findTaskQuestion, createTaskQuestion, twoColumns, t, submitTaskAction, createTaskInput }) {
  const React = requireModule('react')
  const {
    MarkdownText,
    StateDot,
    relativeTime,
  } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
  const list = useSessions((snapshot) => snapshot)
  const panelActive = usePanelInfo((info) => info.activePanelId !== null)
  const workspaces = useWorkspaces((snapshot) => snapshot)
  // 0.2 carries the pending interaction on the Session status snapshot —
  // `Map<sessionId, { running, pendingInteraction, completionUnread }>`, reached
  // through the global standard prop every slot entry receives. The 0.1.5
  // pending-interaction hook was removed in 0.2, and reading it there yielded
  // `undefined` at render time: the TypeError retired this slot entry as an
  // abdicating crash and the whole sidebar column vanished.
  const sessionStatuses = useSessionStatus((snapshot) => snapshot)
  const connectionState = useTaskConnection((snapshot) => snapshot)
  const taskPins = useTaskPins((snapshot) => snapshot)
  const pendingInteractions = React.useMemo(() => {
    const next = new Map()
    // Metadata discovery is read-only; opening history is owned by an actual card.
    for (const id of taskPins.queue.sessionIds) {
      const target = findTaskQuestion?.(id)
      if (target !== undefined) next.set(id, { ...target, key: target.requestKey })
    }
    for (const [id, status] of sessionStatuses) {
      const pending = status?.pendingInteraction
      if (pending != null) next.set(id, pending)
    }
    return next
  }, [sessionStatuses, list, taskPins.queue.sessionIds, findTaskQuestion])
  const appearanceState = useProjectAppearanceSnapshot()
  const [editingWorkspaceId, setEditingWorkspaceId] = React.useState(null)
  const [taskAction, setTaskAction] = React.useState(null)
  const [storedExpanded, setExpanded] = useStoredExpansion('dsh-better-tasks.projection-expansion.v2', 'dsh-better-tasks.projection-expansion.v1')
  const [finalAutoCycles, setFinalAutoCycles] = useStoredRecord('dsh-better-tasks.final-auto-open-cycle.v1')
  const [goalAutoCycles, setGoalAutoCycles] = useStoredRecord('dsh-better-tasks.goal-auto-open-cycle.v1')
  const [todoAutoCycles, setTodoAutoCycles] = useStoredRecord('dsh-better-tasks.todo-expansion-cycle.v1')
  const [drag, setDrag] = React.useState(null)
  const dragClickGuard = React.useRef(null)
  const dragOriginGuard = React.useRef(null)
  const [pendingFinalIds, setPendingFinalIds] = React.useState(() => new Set())
  const finalClicks = React.useRef(null)
  if (finalClicks.current === null) finalClicks.current = createFinalClickController(undefined, undefined, (id, active) => {
    setPendingFinalIds((current) => {
      if (current.has(id) === active) return current
      const next = new Set(current)
      if (active) next.add(id)
      else next.delete(id)
      return next
    })
  })
  React.useEffect(() => () => finalClicks.current.dispose(), [])
  const [moveError, setMoveError] = React.useState('')
  const [actionWarning, setActionWarning] = React.useState('')

  const tasks = derivePinnedTasks({
    list,
    panelActive,
    pinnedSessionIds: taskPins.queue.sessionIds,
    pendingInteractions,
  })
  const taskIds = tasks.map((task) => task.id)
  const goalTasks = tasks.filter((task) => task.goal.availability === 'ready' && typeof task.goal.id === 'string').map((task) => ({ id: task.id, goalId: task.goal.id }))
  const endedGoalTaskIds = tasks.filter((task) => task.goal.availability === 'none').map((task) => task.id)
  const goalCycleKey = `${goalTasks.map((task) => `${task.id}:${task.goalId}`).join('|')}::${endedGoalTaskIds.join('|')}`
  React.useEffect(() => {
    setGoalAutoCycles((cycles) => reconcileGoalExpansionCycles(cycles, goalTasks, endedGoalTaskIds, {}).cycles)
    setExpanded((value) => reconcileGoalExpansionCycles(goalAutoCycles, goalTasks, endedGoalTaskIds, value).expanded)
  }, [goalCycleKey])
  const todoCycleKey = JSON.stringify(tasks.map((task) => [task.id, todoExpansionCycle(task)]))
  React.useEffect(() => {
    setTodoAutoCycles((cycles) => reconcileTodoExpansionCycles(cycles, tasks, {}).cycles)
    // Functional updates preserve Goal/Final changes from this same commit.
    setExpanded((value) => reconcileTodoExpansionCycles(todoAutoCycles, tasks, value).expanded)
  }, [todoCycleKey])
  const idleTasks = tasks.filter((task) => task.session.status === 'idle').map((task) => ({ id: task.id, updatedAt: task.updatedAt, current: task.current }))
  const idleCycleKey = JSON.stringify(idleTasks)
  // Resolve BEFORE effects: display, lazy reads and manual gesture checks must
  // agree on current-cycle suppression, without a flash or an eager Final read.
  const expanded = expandFinalForIdleCycles(finalAutoCycles, idleTasks, storedExpanded).expanded
  React.useEffect(() => {
    const unseen = idleTasks.filter((task) => isNewFinalIdleCycle(finalAutoCycles, task))
    if (unseen.length === 0) return
    setFinalAutoCycles((cycles) => expandFinalForIdleCycles(cycles, unseen, {}).cycles)
    setExpanded((value) => expandFinalForIdleCycles(finalAutoCycles, unseen, value).expanded)
  }, [idleCycleKey])
  const [finalStates, setFinalStates] = React.useState(loadFinalMessageCache)
  React.useEffect(() => {
    writeStorage(FINAL_CACHE_KEY, serializeFinalMessageCache(finalStates))
  }, [finalStates])
  const finalRequests = tasks.filter((task) => {
    if (task.session.status !== 'idle' || !isProjectionExpanded(expanded, `${task.id}:final`, preferences.defaultFinalExpanded)) return false
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
  const finalShortcutState = React.useRef(null)
  finalShortcutState.current = { tasks: new Map(tasks.map((task) => [task.id, task])), finalStates, expanded, preferences, finalAutoCycles }
  const cardFinalRequests = React.useRef(null)
  React.useEffect(() => {
    const changeFinalDisclosure = (id, visible) => {
      const snapshot = finalShortcutState.current
      const task = snapshot.tasks.get(id)
      if (task?.session.status !== 'idle') return
      finalClicks.current.cancel(id)
      const idleTask = { id, updatedAt: task.updatedAt, current: task.current }
      // Commit the same lifecycle and effective state the gesture observed;
      // otherwise a not-yet-persisted background cycle could erase manual close.
      setFinalAutoCycles((cycles) => expandFinalForIdleCycles(cycles, [idleTask], {}).cycles)
      setExpanded((current) => {
        const resolved = expandFinalForIdleCycles(snapshot.finalAutoCycles, [idleTask], current).expanded
        return resolved[`${id}:final`] === visible ? resolved : { ...resolved, [`${id}:final`]: visible }
      })
    }
    const operation = createCardFinalExpansionController({
      getTask: (id) => finalShortcutState.current.tasks.get(id),
      getCached: (id) => finalShortcutState.current.finalStates[id],
      isExpanded: (id) => isProjectionExpanded(finalShortcutState.current.expanded, `${id}:final`, finalShortcutState.current.preferences.defaultFinalExpanded),
      readFinal: async (request, signal) => {
        const response = await fetch(`/api/better-tasks/final-message?sessionId=${encodeURIComponent(request.id)}`, { cache: 'no-store', signal })
        const value = await response.json()
        if (!response.ok) throw new Error(value?.message ?? value?.code ?? `HTTP ${response.status}`)
        return value
      },
      onReady: (request, value) => setFinalStates((current) => {
        const task = finalShortcutState.current.tasks.get(request.id)
        if (task?.session.status !== 'idle' || task.updatedAt !== request.updatedAt) return current
        return { ...current, [request.id]: { status: 'ready', updatedAt: request.updatedAt, value } }
      }),
      expand: (id) => changeFinalDisclosure(id, true),
      collapse: (id) => changeFinalDisclosure(id, false),
    })
    cardFinalRequests.current = operation
    return () => {
      operation.dispose()
      if (cardFinalRequests.current === operation) cardFinalRequests.current = null
    }
  }, [])
  const finalShortcutKey = JSON.stringify(tasks.map((task) => [task.id, task.session.status, task.updatedAt]))
  React.useEffect(() => { cardFinalRequests.current?.reconcile() }, [finalShortcutKey])
  const workspaceBySession = indexWorkspacesBySession(workspaces.items)
  const appearanceByWorkspace = new Map(appearanceState.items.map((item) => [item.workspaceId, item]))
  const iconByKey = new Map(appearanceState.icons.map((icon) => [icon.key, icon]))
  const editingWorkspace = workspaces.items.find((workspace) => workspace.workspaceId === editingWorkspaceId)
  const pendingMoves = new Set(taskPins.pendingSessionIds)
  const now = Date.now()
  const toggleProjection = (sessionId, key, defaultExpanded) => {
    if (key === 'final') cardFinalRequests.current?.cancel(sessionId)
    const disclosureKey = `${sessionId}:${key}`
    setExpanded((current) => {
      const resolved = key === 'final' || key === 'input'
        ? expandFinalForIdleCycles(finalAutoCycles, idleTasks, current).expanded
        : current
      return { ...resolved, [disclosureKey]: !isProjectionExpanded(resolved, disclosureKey, defaultExpanded) }
    })
  }
  const commitDrop = (overId, half) => {
    if (drag === null || taskPins.writable !== true) return
    const sessionId = drag.sessionId
    const beforeSessionId = beforeIdForTaskDrop(taskIds, overId, half)
    setDrag(null)
    if (beforeSessionId === sessionId) return
    setMoveError('')
    moveTaskBefore(sessionId, beforeSessionId).catch((error) => setMoveError(String(error?.message ?? error)))
  }

  return element('section', {
    className: 'dbt-task-view',
    'aria-label': t('view.tasks'),
    style: { '--dbt-projection-font-size': `${preferences.detailFontSize}px` },
  },
    appearanceState.status === 'unavailable' ? element('div', { className: 'dbt-task-warning', role: 'status' }, t('tasks.appearanceUnavailable')) : null,
    ['initializing', 'running'].includes(taskPins.migration) ? element('div', { className: 'dbt-task-warning', role: 'status' }, t('tasks.pinMigration')) : null,
    taskPins.error !== null || moveError !== '' ? element('div', { className: 'dbt-task-warning', role: 'status' }, moveError || taskPins.error) : null,
    actionWarning === '' ? null : element('div', { className: 'dbt-task-warning', role: 'alert' }, actionWarning),
    tasks.length === 0 ? element('div', { className: 'dbt-task-empty' }, t('tasks.empty')) :
      element('div', {
        className: 'dbt-task-list',
        'data-columns': twoColumns ? '2' : '1',
        'data-title-emphasis': preferences.titleEmphasis,
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
        const goalExpanded = goalAvailable && isProjectionExpanded(expanded, `${task.id}:goal`, preferences.defaultGoalExpanded)
        const todoExpanded = todoAvailable && task.todos.total > 0 && isProjectionExpanded(expanded, `${task.id}:todo`, preferences.defaultTodoExpanded)
        const finalExpanded = task.session.status === 'idle' && isProjectionExpanded(expanded, `${task.id}:final`, preferences.defaultFinalExpanded)
        const inputExpanded = finalExpanded && isProjectionExpanded(expanded, `${task.id}:input`, preferences.defaultInputExpanded)
        const finalState = finalStates[task.id]
        const pendingInteraction = pendingInteractions.get(task.id)
        const questionTarget = pendingInteraction?.kind === 'question' || pendingInteraction?.kind === 'plan-review'
          ? { sessionId: task.id, kind: pendingInteraction.kind,
            requestKey: pendingInteraction.key ?? pendingInteraction.requestKey, callId: pendingInteraction.callId }
          : undefined
        const answerCallId = questionTarget?.callId
        const inlineQuestion = questionTarget?.kind === 'question' &&
          (typeof questionTarget.requestKey === 'string' || typeof answerCallId === 'string')
        const answerable = inlineQuestion || typeof answerCallId === 'string' && canRevealQuestion()
        const goalLabel = task.goal.availability === 'ready' ? `${task.goal.phase}: ${task.goal.objective}` : availabilityLabel(task.goal, t)
        const todoLabel = task.todos.availability === 'ready' ? `${task.todos.completed}/${task.todos.total}` : availabilityLabel(task.todos, t)
        const executionWarning = taskExecutionWarning({
          ...list.byId[task.id],
          running: sessionStatuses.get(task.id)?.running ?? list.byId[task.id].running,
        }, pendingInteraction, connectionState, list.phase === undefined || list.phase === 'ready')
        const warningLabel = executionWarning === null ? '' : t(`tasks.execution.${executionWarning.kind}`)
        const stateLabel = executionWarning === null
          ? (task.session.status === 'block' ? t('tasks.blockAria') : task.session.status === 'running' ? t('tasks.runningAria') : t('tasks.idleAria'))
          : [warningLabel, executionWarning.detail].filter(Boolean).join('\n')
        const dropHalf = drag?.overId === task.id ? drag.half : undefined
        const detailRows = []
        if (goalExpanded) detailRows.push(element('div', {
          key: 'goal',
          className: 'dbt-projection-detail',
          'data-tone': task.goal.phase ?? task.goal.availability,
          title: goalLabel,
          'aria-label': `${t('tasks.goal')}: ${goalLabel}`,
        },
        element(IconGoalOutlineRegular, { size: 14 }),
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
        element(IconChecklistOutlineRegular, { size: 14 }),
        element('div', { className: 'dbt-projection-copy' }, task.todos.availability === 'ready' ?
          element('ul', { className: 'dbt-todo-list' }, ...task.todos.items.map((todo, index) => element('li', {
            key: `${index}:${todo.content}`,
            className: 'dbt-todo-item',
            title: todo.status,
          },
          element('span', { className: 'dbt-todo-glyph', role: 'img', 'aria-label': t(todo.status === 'completed' ? 'tasks.todoCompleted' : todo.status === 'in_progress' ? 'tasks.todoInProgress' : 'tasks.todoPending') },
            element(StateDot, { state: todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'ongoing' : 'idle' })),
          element('span', null, todo.content)))) : availabilityLabel(task.todos, t))))
        if (finalExpanded) {
          let finalContent
          if (finalState === undefined || finalState.status === 'loading') {
            finalContent = t('tasks.finalLoading')
          } else if (finalState.status === 'error') {
            finalContent = t('tasks.finalError')
          } else if (finalState.value.final === null) {
            finalContent = t('tasks.finalNone')
          } else {
            finalContent = element(React.Fragment, null,
              element('div', { className: 'dbt-final-copy' }, element(MarkdownText, {
                text: finalState.value.final.text,
                labels: { code: { copyLabel: t('tasks.copyCode'), copiedLabel: t('tasks.copiedCode') }, footnotes: t('tasks.footnotes') },
              })),
              finalState.value.truncated ? element('div', { className: 'dbt-final-meta' }, `${t('tasks.finalTruncated')} · ${finalState.value.totalCodePoints}`) : null)
          }
          detailRows.push(element('div', {
            key: 'final',
            className: 'dbt-projection-detail dbt-final-detail',
            'data-feedback': pendingFinalIds.has(task.id) ? 'pending' : undefined,
            'data-tone': finalState?.status ?? 'loading',
            'aria-label': t('tasks.final'),
          }, element('div', {
            className: 'dbt-final-input-toggle', role: 'button', tabIndex: 0,
            'data-no-card-drag': true, draggable: false,
            'aria-expanded': inputExpanded,
            'aria-label': t(inputExpanded ? 'tasks.collapseInput' : 'tasks.expandInput'),
            onClickCapture: (event) => {
              if (!shouldToggleFinalInput(event.target)) return
              if (event.detail === 2 && finalClicks.current.doubleClick(task.id, () => toggleProjection(task.id, 'final', preferences.defaultFinalExpanded))) {
                event.preventDefault()
                return
              }
              if (event.detail > 2) return
              finalClicks.current.click(task.id, () => toggleProjection(task.id, 'input', preferences.defaultInputExpanded))
            },
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
              event.preventDefault()
              event.stopPropagation()
              finalClicks.current.cancel(task.id)
              toggleProjection(task.id, 'input', preferences.defaultInputExpanded)
            },
          }, element('div', { className: 'dbt-projection-copy' }, finalContent)),
          finalState?.status === 'error' ? element('button', {
            type: 'button', className: 'dbt-final-retry', 'data-no-card-drag': true, draggable: false,
            title: finalState.message,
            onClick: () => setFinalRetry((value) => value + 1),
          }, t('tasks.finalRetry')) : null))
        }
        return element('article', {
          key: task.id,
          className: 'dbt-task-card',
          'data-session-id': task.id,
          'data-current': String(task.current),
          'data-state': task.session.status,
          'data-execution-warning': executionWarning?.kind,
          'data-drop': dropHalf,
          'aria-label': `${projectName}: ${stateLabel}`,
          title: stateLabel,
          tabIndex: 0,
          draggable: taskPins.writable === true && !pendingMoves.has(task.id),
          onPointerDownCapture: (event) => {
            dragOriginGuard.current = event.target?.closest?.('[data-no-card-drag]') ? task.id : null
          },
          onKeyDown: (event) => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
            event.preventDefault()
            openSession(task.id)
          },
          onClick: (event) => {
            const fromControl = event.detail !== 0 && dragOriginGuard.current === task.id
            dragOriginGuard.current = null
            if (fromControl || event.target?.closest?.('[data-no-card-drag]') || dragClickGuard.current === task.id) return
            openSession(task.id)
            // The browser's second click is the double-click gesture. Keep the
            // first click immediate; do not re-open Final after its own body
            // double-click unmounts that control before a later dblclick event.
            if (event.detail === 2 && isTaskCardFinalShortcutTarget(event.target)) {
              void cardFinalRequests.current?.request(task.id)
            }
          },
          onDragStart: (event) => {
            if (taskPins.writable !== true) { event.preventDefault(); return }
            if (dragOriginGuard.current === task.id || event.target?.closest?.('[data-no-card-drag]')) {
              dragOriginGuard.current = null
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
          element('div', { className: 'dbt-task-open' },
            element('span', { className: 'dbt-task-project' }, projectName),
            element('span', { className: 'dbt-task-session-line' },
              executionWarning !== null ? element('svg', {
                className: 'dbt-task-error-icon', width: 14, height: 14, viewBox: '0 0 24 24',
                fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true,
              }, element('path', { d: 'M12 3 2 21h20L12 3Z', strokeLinejoin: 'round' }),
              element('path', { d: 'M12 9v5m0 3v1' })) :
              task.session.status === 'running' ? element(StateDot, { state: 'ongoing' }) : null,
              element('button', { type: 'button', className: 'dbt-task-rename', 'data-no-card-drag': true, draggable: false,
                title: t('tasks.rename'), 'aria-label': `${t('tasks.rename')}: ${task.title}`,
                onClick: () => setTaskAction({ kind: 'rename', id: task.id, title: task.title }),
              }, task.title),
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
          }, renderOfficialPinIcon(14))),
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
            onClick: () => { if (goalAvailable) toggleProjection(task.id, 'goal', preferences.defaultGoalExpanded) },
          }, element(IconGoalOutlineRegular, { size: 14 }), element(goalExpanded ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, { size: 14 })),
          todoVisible ? element('button', {
            type: 'button',
            className: 'dbt-projection-toggle',
            'data-no-card-drag': true,
            draggable: false,
            disabled: !todoAvailable,
            'aria-expanded': todoExpanded,
            'aria-label': t(todoExpanded ? 'tasks.collapseTodo' : 'tasks.expandTodo'),
            title: todoLabel,
            onClick: () => { if (todoAvailable) toggleProjection(task.id, 'todo', preferences.defaultTodoExpanded) },
          }, element(IconChecklistOutlineRegular, { size: 14 }), todoAvailable ? element('span', { className: 'dbt-todo-count' }, todoLabel) : null, element(todoExpanded ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, { size: 14 })) : null,
          task.session.status !== 'idle' ? null : element('button', {
            type: 'button',
            className: 'dbt-projection-toggle',
            'data-no-card-drag': true,
            draggable: false,
            'aria-expanded': finalExpanded,
            'aria-label': t(finalExpanded ? 'tasks.collapseFinal' : 'tasks.expandFinal'),
            title: t('tasks.final'),
            onClick: () => {
              finalClicks.current.cancel(task.id)
              toggleProjection(task.id, 'final', preferences.defaultFinalExpanded)
            },
          }, element(IconSparkleRegular, { size: 14 }), element(finalExpanded ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, { size: 14 }))),
        detailRows.length === 0 ? null : element('div', { className: 'dbt-projection-details' }, ...detailRows),
        task.session.status !== 'idle' ? null : element('div', {
          className: 'dbt-continue-shell', hidden: !inputExpanded,
          'data-no-card-drag': true, draggable: false,
          onDragStart: (event) => event.preventDefault(),
        }, element(TaskContinueInput, {
          sessionId: task.id,
          active: inputExpanded,
          createTaskInput,
          t,
          onWarning: (warning) => setActionWarning(`${t('tasks.goalResumeWarning')}: ${warning}`),
        })),
        answerable ? element('div', {
          className: 'dbt-question-surface',
          'data-no-card-drag': true,
          draggable: false,
          onDragStart: (event) => event.preventDefault(),
        },
        inlineQuestion ? element(TaskQuestionCard, {
          key: `${task.id}:${questionTarget.requestKey ?? questionTarget.callId}`,
          target: questionTarget, createTaskQuestion, fontSize: preferences.detailFontSize,
          revealQuestion, canRevealQuestion, t,
        }) : element('button', {
          type: 'button',
          className: 'dbt-task-answer',
          title: t('tasks.answerHint'),
          onClick: (event) => {
            event.stopPropagation()
            const revealed = revealQuestion(task.id, answerCallId)
            // `null` is "this composition has no question service" (already
            // filtered out above); `false` is "the panel exists but would not
            // open". Only the latter is worth telling the user about.
            if (revealed === false) setActionWarning(t('tasks.answerFailed'))
          },
        }, t('tasks.answer'))) : null)
      }))),
    editingWorkspace !== undefined ? element(AppearanceDialog, {
      workspace: editingWorkspace,
      appearance: appearanceByWorkspace.get(editingWorkspace.workspaceId),
      appearanceState,
      onClose: () => setEditingWorkspaceId(null),
      t,
    }) : null,
    taskAction === null ? null : element(TaskActionDialog, {
      key: `${taskAction.kind}:${taskAction.id}`,
      action: taskAction,
      onClose: () => setTaskAction(null),
      onSubmit: (action, text) => {
        const current = tasks.find((item) => item.id === action.id)
        if (current === undefined || action.kind === 'continue' && current.session.status !== 'idle') throw new Error(t('tasks.actionUnavailable'))
        return submitTaskAction(action, text)
      },
      t,
    }))
}

function SidebarRegion({ wide, collapsed, view, setView, twoColumns, preferences, toggleSidebar, renderSlot, useSessions, useWorkspaces, useSessionStatus, useTaskConnection, usePanelInfo, useTaskPins, openSession, moveTaskBefore, unpinTask, revealQuestion, canRevealQuestion, findTaskQuestion, createTaskQuestion, submitTaskAction, createTaskInput, t }) {
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
        useSessionStatus, useTaskConnection,
        usePanelInfo,
        useTaskPins,
        openSession,
        moveTaskBefore,
        unpinTask,
        revealQuestion,
        canRevealQuestion,
        findTaskQuestion,
        createTaskQuestion,
        submitTaskAction,
        createTaskInput,
        twoColumns,
        preferences,
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

/**
 * Guarded root: the component actually handed to `ctx.slots.register`.
 *
 * Two narrow jobs:
 *  1. Forensics — record whether a hook can legally run in this frame. That one
 *     fact separates "React called us" from "something called the component as a
 *     plain function", which is the difference between a props bug and an
 *     unsupported call site.
 *  2. Containment — a bare call (no arguments) from anywhere outside React gets a
 *     visible diagnostic block instead of throwing. A throw during render is what
 *     makes the slot retire the occupant and blank the whole column.
 *
 * It deliberately owns no hook except the probe, so the short circuit below can
 * never change the real component's hook order.
 */
export function SidebarRootGuard(props) {
  const React = requireModule('react')
  const startedAt = Date.now()
  // Probe FIRST: a guard that returned before this would hide the very bare call
  // the probe exists to observe, and B would be misread as "did not crash".
  let hookOk = true
  try { React.useState(0) } catch { hookOk = false }
  const zeroArg = arguments.length === 0
  // Captured here, while this frame is still the top of the stack: inside the
  // caller, not after createElement. Empty for a React render, which needs none.
  const stack = zeroArg && !hookOk ? captureCallStack() : ''
  if (RENDER_PROBE) {
    writeRenderProbe({
      zeroArg,
      isElement: React.isValidElement(props),
      propKeys: props !== null && typeof props === 'object' ? Object.keys(props).slice(0, 8) : [],
      durationMs: Date.now() - startedAt,
      hookOk,
      stack,
    })
    if (renderProbeCount === 1) {
      writeStorage(RENDER_ENV_KEY, JSON.stringify({
        revision: BUILD_REVISION,
        reactVersion: React.version,
        propsNull: props === null || props === undefined,
        argCount: arguments.length,
      }))
    }
  }
  // Dry-run guard, after the probe.
  if (zeroArg && !hookOk) {
    return React.createElement('div', {
      'data-better-tasks-diagnostic': 'bare-call',
      style: { padding: '10px', font: '12px/1.5 ui-monospace, monospace', color: '#ff8f8f' },
    }, `Better Tasks: sidebar root invoked outside React (revision ${BUILD_REVISION})`)
  }
  // Safe defaults keep the real component's hook sequence stable.
  const safe = props === null || props === undefined ? {} : props
  // Rendered as an element so the real component keeps its own fiber. The
  // occupant's throw came from an undefined element type (React #130) among the
  // descendant icons, which is fixed at the source; no boundary is carried here.
  return React.createElement(BetterSidebarRoot, safe)
}

/** AppFrame mounts this root-scoped chrome seat only while the macOS rail is hidden. */
export function SidebarReopenControls({ toggleSidebar, startSession, t }) {
  const { Tooltip, IconPanelLeftOutlineRegular: PanelIcon, IconNewChatOutlineRegular: NewIcon } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
  return element('div', { className: 'dbt-shell-leading' },
    element(Tooltip, {
      label: t('toggle.open'), delayMs: 500, portal: true,
      children: element('button', {
        type: 'button', className: 'dbt-icon-button',
        'aria-label': t('toggle.open'), 'aria-expanded': false,
        onClick: toggleSidebar,
      }, element(PanelIcon, { size: 16 })),
    }),
    element(Tooltip, {
      label: t('session.new.label'), delayMs: 500, portal: true,
      children: element('button', {
        type: 'button', className: 'dbt-icon-button',
        'aria-label': t('session.new.label'),
        onClick: () => startSession(),
      }, element(NewIcon, { size: 16 })),
    }))
}

export function BetterSidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  selectPanel,
  usePanels,
  usePanelInfo,
  useSessions,
  useWorkspaces,
  useSessionStatus, useTaskConnection,
  useTaskPins,
  useTaskPreferences,
  setTaskPreference,
  openSession,
  moveTaskBefore,
  unpinTask,
  revealQuestion,
  canRevealQuestion,
  findTaskQuestion,
  createTaskQuestion,
  submitTaskAction,
  createTaskInput,
  t,
  renderSlot,
}) {
  const React = requireModule('react')
  const { Tooltip } = requireModule('@deepseek-ai/dsh-client-ui-primitives')
  const panels = usePanels((value) => value)
  const preferences = useTaskPreferences((snapshot) => snapshot.value)
  // D1: the view is a Config preference rather than plugin-local localStorage, so
  // the Host persists it and 0.2 and 0.1.5 reach it through the same path. The old
  // localStorage value is folded in once by migrateLegacySidebarView().
  const view = preferences.sidebarView === 'tasks' ? 'tasks' : 'native'
  const setView = (next) => {
    void Promise.resolve(setTaskPreference('sidebarView', next === 'tasks' ? 'tasks' : 'native')).catch(() => {})
  }
  const windowsTitlebar = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-windows-titlebar')
  const [settled, setSettled] = React.useState(collapsed)
  React.useEffect(() => {
    if (!collapsed) {
      setSettled(false)
      return undefined
    }
    const timer = window.setTimeout(() => setSettled(true), 150)
    return () => window.clearTimeout(timer)
  }, [collapsed])
  const wide = windowsTitlebar ? !collapsed : !collapsed || !settled
  const twoColumns = !collapsed && (preferences.columnLayout === 'double' || (preferences.columnLayout === 'auto' && width > TASK_GRID_TWO_COLUMN_THRESHOLD))
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
      side: windowsTitlebar ? 'bottom' : 'right',
      portal: windowsTitlebar,
      children: element('button', {
        type: 'button',
        className: 'dbt-icon-button dbt-toggle',
        'aria-label': toggleLabel,
        'aria-expanded': !collapsed,
        onClick: toggleSidebar,
      },
      !wide && !windowsTitlebar ? element('span', { className: 'dbt-rail-mark', 'aria-hidden': 'true' },
        renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: element('span', null, '◆') })) : null,
      element(IconPanelLeftOutlineRegular, { className: 'dbt-panel-icon', size: wide || windowsTitlebar ? 16 : 18 }))
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
      preferences,
      toggleSidebar,
      renderSlot,
      useSessions,
      useWorkspaces,
      useSessionStatus, useTaskConnection,
      usePanelInfo,
      useTaskPins,
      openSession,
      moveTaskBefore,
      unpinTask,
      revealQuestion,
      canRevealQuestion,
      findTaskQuestion,
      createTaskQuestion,
      submitTaskAction,
      createTaskInput,
      t,
    })),
  element('div', { className: 'dbt-foot' },
    element('div', { className: 'dbt-footer-actions' }, renderSlot('sidebar.footer.action', { wide })),
    element('div', { className: 'dbt-settings' }, renderSlot('sidebar.settings', { wide }))))
}

function TaskSettingsSection({ useTaskPreferences, setTaskPreference, t }) {
  const React = requireModule('react')
  const element = React.createElement
  const snapshot = useTaskPreferences((value) => value)
  const [draft, setDraft] = React.useState(snapshot.value)
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setDraft(snapshot.value), [snapshot.value])
  const writable = snapshot.status === 'ready' && snapshot.writable && !pending
  const update = (field, value) => {
    if (!writable) return
    setDraft((current) => ({ ...current, [field]: value }))
    setFailed(false)
    setPending(true)
    Promise.resolve(setTaskPreference(field, value)).catch(() => {
      setDraft(snapshot.value)
      setFailed(true)
    }).finally(() => setPending(false))
  }
  const switchRow = (field, label) => element('div', { className: 'dbt-settings-switch-row', key: field },
    element('span', null, label),
    element('button', {
      type: 'button',
      role: 'switch',
      className: 'dbt-settings-switch',
      'aria-label': label,
      'aria-checked': String(draft[field]),
      disabled: !writable,
      onClick: () => update(field, !draft[field]),
    }))
  const status = failed
    ? element('div', { className: 'dbt-settings-status', 'data-error': true }, t('settings.writeFailed'))
    : snapshot.status === 'loading'
      ? element('div', { className: 'dbt-settings-status' }, t('settings.loading'))
      : snapshot.status === 'unavailable'
        ? element('div', { className: 'dbt-settings-status' }, t('settings.unavailable'))
      : snapshot.status === 'ready' && !snapshot.writable
        ? element('div', { className: 'dbt-settings-status' }, t('settings.readOnly'))
        : null
  return element('section', { className: 'dbt-settings-section', 'aria-labelledby': 'dbt-settings-title' },
    element('div', { className: 'dbt-settings-heading' },
      element('h2', { id: 'dbt-settings-title' }, t('settings.title')),
      element('p', null, t('settings.description'))),
    status,
    element('div', { className: 'dbt-settings-group' },
      element('div', { className: 'dbt-settings-group-title' }, t('settings.fontSize')),
      element('div', { className: 'dbt-settings-card' },
        element('div', { className: 'dbt-settings-font-options' },
          ...[11, 12, 13, 14, 15, 16].map((size) => element('button', {
            key: size,
            type: 'button',
            className: 'dbt-settings-font-option',
            'aria-label': `${size}px`,
            'aria-pressed': String(draft.detailFontSize === size),
            disabled: !writable,
            onClick: () => update('detailFontSize', size),
          }, `${size}px`))),
        element('p', { className: 'dbt-settings-hint' }, t('settings.fontSizeHint')))),
    element('div', { className: 'dbt-settings-group' },
      element('div', { className: 'dbt-settings-group-title' }, t('settings.titleEmphasis')),
      element('div', { className: 'dbt-settings-card' },
        element('div', { className: 'dbt-settings-segments', 'data-options': '2' },
          ...['project', 'task'].map((emphasis) => element('button', {
            key: emphasis,
            type: 'button',
            className: 'dbt-settings-segment',
            'aria-pressed': String(draft.titleEmphasis === emphasis),
            disabled: !writable,
            onClick: () => update('titleEmphasis', emphasis),
          }, t(`settings.titleEmphasis.${emphasis}`)))),
        element('p', { className: 'dbt-settings-hint' }, t('settings.titleEmphasisHint')))),
    element('div', { className: 'dbt-settings-group' },
      element('div', { className: 'dbt-settings-group-title' }, t('settings.defaultExpansion')),
      element('div', { className: 'dbt-settings-card' },
        switchRow('defaultTodoExpanded', t('settings.todoExpanded')),
        switchRow('defaultGoalExpanded', t('settings.goalExpanded')),
        switchRow('defaultFinalExpanded', t('settings.finalExpanded')),
        switchRow('defaultInputExpanded', t('settings.inputExpanded')),
        element('p', { className: 'dbt-settings-hint' }, t('settings.expansionHint')))),
    element('div', { className: 'dbt-settings-group' },
      element('div', { className: 'dbt-settings-group-title' }, t('settings.columns')),
      element('div', { className: 'dbt-settings-card' },
        element('div', { className: 'dbt-settings-segments' },
          ...['auto', 'single', 'double'].map((layout) => element('button', {
            key: layout,
            type: 'button',
            className: 'dbt-settings-segment',
            'aria-pressed': String(draft.columnLayout === layout),
            disabled: !writable,
            onClick: () => update('columnLayout', layout),
          }, t(`settings.columns.${layout}`)))),
        element('p', { className: 'dbt-settings-hint' }, t('settings.columnsHint')))))
}

function mountTaskSettingsSection(ctx, taskPreferences) {
  const injected = () => ({
    hooks: { taskPreferences: taskPreferences.source },
    setTaskPreference: (field, value) => taskPreferences.set(field, value),
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'better-tasks',
    order: 45,
    label: () => ctx.locale.bind(NS)('settings.nav'),
    locale: NS,
    inject: injected,
  }, TaskSettingsSection))
}

function mountSidebar(ctx, taskPins, taskPreferences) {
  // One confirmed native membership source for the official list and task cards.
  // uiWorkspace adds the official sidebar pin-fronting policy without navigation.
  ctx.effect(() => taskPins.connectNative({
    source: ctx.get?.('workspaces')?.list,
    pinSession: (id) => ctx.uiWorkspace.pinSession(id),
    unpinSession: (id) => ctx.uiWorkspace.unpinSession(id),
  }), 'dsh-better-tasks: native Pin projection')
  ctx.effect(() => ctx.uiWorkspace.onSessionCreated((sessionId) => taskPins.pinCreated(sessionId)), 'dsh-better-tasks: auto-pin created sessions')

  // 0.2's catalog is metadata-only until projections are explicitly requested.
  // Read the Host-owned snapshots for pinned sessions, including unopened ones;
  // sessions.refreshProjections deduplicates per connection and needs no retain.
  ctx.effect(() => {
    const refresh = () => {
      const sessions = ctx.get?.('sessions')
      if (typeof sessions?.refreshProjections !== 'function') return
      for (const id of taskPins.source.getSnapshot().queue.sessionIds) {
        void sessions.refreshProjections(id).catch(() => {})
      }
    }
    const stop = taskPins.source.subscribe(refresh)
    refresh()
    return stop
  }, 'dsh-better-tasks: pinned session projections')

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

  // Optional factory lookup keeps startup independent of the input providers.
  // The surface owns its retained generation; metadata reads are not editor leases.
  const taskInputs = createTaskInputManager({
    getConversation: () => ctx.get('conversation'),
    getSessions: () => ctx.get('sessions'),
    getStatus: (id) => ctx.get('uiSession')?.sessionStatus.getSnapshot().get(id),
    getGoals: () => ctx.get('remote.goals') ?? ctx.get('remote')?.goals,
    isPinned: (id) => taskPins.source.getSnapshot().queue.sessionIds.includes(id),
  })
  const createTaskInput = (sessionId, options) => taskInputs.create(sessionId, options)
  const findTaskQuestion = (sessionId) => {
    try { return ctx.get('questionSurface')?.find?.(sessionId) }
    catch { return undefined } // Optional discovery cannot retire the sidebar root.
  }
  const createTaskQuestion = (options) => {
    const provider = ctx.get('questionSurface')
    if (typeof provider?.createCard !== 'function') throw new Error('Inline question surface is unavailable')
    return provider.createCard(options)
  }
  ctx.effect(() => () => taskInputs.dispose(), 'dsh-better-tasks: input surfaces')

  const taskConnection = ctx.get?.('connection')?.state ?? createSnapshotStore(undefined)
  const injectProps = () => ({
    setTaskPreference: (field, value) => taskPreferences.set(field, value),
    startSession: (workspaceId, beforeOpen) => ctx.uiWorkspace.startSession(workspaceId, beforeOpen),
    toggleSidebar: () => ctx.layout.toggleSidebar(),
    selectPanel: (panelId) => ctx.layout.selectPanel(panelId),
    openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
    moveTaskBefore: (sessionId, beforeSessionId) => taskPins.moveBefore(sessionId, beforeSessionId),
    unpinTask: (sessionId) => taskPins.setPinned(sessionId, false),
    createTaskInput,
    findTaskQuestion,
    createTaskQuestion,
    submitTaskAction: (action, text) => {
      if (action.kind !== 'rename') throw new Error('Messages must use the native input surface')
      return taskInputs.rename(action.id, text)
    },
    // Optional by design: a composition without `ui-user-questions` (or without
    // this Session's call identity) hides the action instead of rendering a dead
    // button. Probed per render, not memoized: the service may load later.
    canRevealQuestion: () => ctx.get('userQuestionPanels') !== undefined,
    revealQuestion: (sessionId, callId) => ctx.get('userQuestionPanels')?.reveal(sessionId, callId) ?? null,
    hooks: { panels, taskPins: taskPins.source, taskPreferences: taskPreferences.source, taskConnection },
  })

  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    locale: NS,
    children: createSidebarChildDeclarations(),
    inject: injectProps,
  }, SidebarRootGuard))
  // Disabling native ui-sidebar removes more than its column root. Restore its
  // outside-the-column reopen seat without taking over the native frame.
  ctx.slots.inject('shell.leading', () => ctx.slots.register({
    name: 'shell.leading',
    locale: NS,
    inject: () => ({
      toggleSidebar: () => ctx.layout.toggleSidebar(),
      startSession: () => ctx.uiWorkspace.startSession(),
    }),
  }, SidebarReopenControls))

  syncPanels()
}

export function apply(ctx) {
  ctx.effect(() => installStyles(), 'dsh-better-tasks: styles')
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-better-tasks: dictionaries')
  const taskPins = createTaskPinsClient()
  const taskPreferences = createTaskPreferencesStore()
  ctx.provide('betterTaskPins', taskPins)
  ctx.effect(() => taskPins.start(), 'dsh-better-tasks: pin projection')
  // Settings, two generations, neither name in the module-level `inject`:
  //   0.1.5 -> `settingsScope.bind({ namespace })` returns the read/write scope.
  //   0.2   -> that service is gone; `configForms.get(entryId)` returns a
  //            ConfigFormController whose getSnapshot/subscribe/set are the same
  //            shape. The namespace is the plugin's own entry id, which is why
  //            TASK_SETTINGS_NAMESPACE is both the 0.1.5 namespace and (by
  //            install convention, as every in-box plugin does) the 0.2 row id.
  // A generation that lacks one name still activates: inject is non-blocking, and
  // only the matching probe fires.
  let settingsBound = false
  /**
   * Fold the pre-D1 localStorage view preference into the Config once.
   *
   * The Config is the single source of truth from now on, so the legacy key is
   * removed only after the Host write lands; a failed or unwritable Host leaves it
   * in place for the next start. Runs behind the settings inject, which is why it
   * cannot be a render-time effect.
   * @param store - the preferences store.
   */
  let migrationPending = false
  const migrateLegacySidebarView = (store) => {
    if (migrationPending) return
    let legacy = null
    try {
      if (localStorage.getItem(VIEW_MIGRATED_KEY) !== null) return
      legacy = localStorage.getItem(LEGACY_VIEW_KEY)
    } catch {
      return
    }
    if (legacy !== 'tasks' && legacy !== 'native') {
      writeStorage(VIEW_MIGRATED_KEY, '1')
      return
    }
    if (store.source.getSnapshot().writable !== true) return
    migrationPending = true
    void Promise.resolve().then(() => store.set('sidebarView', legacy)).then(
      () => {
        try { localStorage.removeItem(LEGACY_VIEW_KEY) } catch {}
        writeStorage(VIEW_MIGRATED_KEY, '1')
      },
      () => {},
    ).finally(() => { migrationPending = false })
  }
  const bindSettings = (scope) => {
    if (settingsBound) return
    const settings = typeof scope.configForms?.get === 'function'
      ? scope.configForms.get(TASK_SETTINGS_ENTRY_ID)
      : typeof scope.settingsScope?.bind === 'function'
        ? scope.settingsScope.bind({ namespace: TASK_SETTINGS_NAMESPACE })
        : undefined
    if (settings === undefined) return
    settingsBound = true
    scope.effect(() => taskPreferences.connect(settings), 'dsh-better-tasks: settings projection')
    // Config forms load asynchronously. Run migration once a writable snapshot
    // arrives, not just while the controller still reports `loading`.
    scope.effect(() => taskPreferences.source.subscribe(() => migrateLegacySidebarView(taskPreferences)), 'dsh-better-tasks: legacy view migration')
    migrateLegacySidebarView(taskPreferences)
    mountTaskSettingsSection(scope, taskPreferences)
  }
  ctx.inject(['configForms'], bindSettings)
  ctx.inject(['settingsScope'], bindSettings)
  ctx.inject(['uiWorkspace'], (scope) => mountSidebar(scope, taskPins, taskPreferences))
}

export const contract = Object.freeze({
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
  taskExecutionWarning,
})
