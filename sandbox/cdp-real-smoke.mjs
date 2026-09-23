const debuggerBase = process.env.DBT_CDP ?? 'http://127.0.0.1:9224'
const targetUrl = process.env.DBT_URL
if (!targetUrl) throw new Error('DBT_URL is required')
async function retry(operation, attempts = 100, delay = 250) {
  let last
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation() } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  throw last
}
await retry(async () => {
  const response = await fetch(`${debuggerBase}/json/version`)
  if (!response.ok) throw new Error(`CDP unavailable: ${response.status}`)
})
const created = await fetch(`${debuggerBase}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
const target = await created.json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let sequence = 0
const pending = new Map()
const errors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
    return
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(`log: ${message.params.entry.text}`)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(`console: ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`)
})
function send(method, params = {}) {
  const id = ++sequence
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')])
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: targetUrl })
await retry(async () => {
  const ready = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.dbt-sidebar')) && document.querySelectorAll('[role="tab"]').length === 2`)
  if (!ready) throw new Error('sidebar not ready')
})
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /会话|Sessions/.test(node.textContent || ''))
  tab?.click()
})()`)
await retry(async () => {
  const ready = await evaluate(`Boolean(document.querySelector('[aria-label="视图选项"], [aria-label="View options"]'))`)
  if (!ready) throw new Error('workspace browser not ready')
})
await evaluate(`(() => {
  for (const group of document.querySelectorAll('[role="treeitem"][aria-expanded="false"]')) group.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 400))
const native = await evaluate(`(() => {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]')
  const panel = document.querySelector('.dbt-region-panel')
  const toggle = document.querySelector('.dbt-toggle')
  const selectedStyle = getComputedStyle(selected)
  const panelStyle = getComputedStyle(panel)
  const toggleStyle = getComputedStyle(toggle)
  return {
    selected: selected.textContent,
    tabMerged: selectedStyle.backgroundColor === panelStyle.backgroundColor,
    toggleSize: [toggleStyle.width, toggleStyle.height],
    officialPanelIcon: Boolean(toggle.querySelector('.dbt-panel-icon')),
    search: Boolean(document.querySelector('[aria-label="搜索会话"], [aria-label="Search sessions"]')),
    addWorkspace: Boolean(document.querySelector('[aria-label="添加工作区"], [aria-label="Add workspace"]')),
    pinButtons: [...document.querySelectorAll('button[aria-pressed]')].map((node) => ({ label: node.getAttribute('aria-label'), pressed: node.getAttribute('aria-pressed') })),
    treeItems: [...document.querySelectorAll('[role="treeitem"]')].map((node) => ({ text: node.textContent, expanded: node.getAttribute('aria-expanded'), className: node.className })),
    workspaceText: document.querySelector('.dbt-workspaces')?.textContent?.slice(0, 1000),
    viewStore: localStorage.getItem('dsh.workspace.view.v5'),
    resourceScripts: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /better-tasks|ui-workspace/.test(name))
  }
})()`)
await evaluate(`document.querySelector('[aria-label="视图选项"], [aria-label="View options"]')?.click()`)
await new Promise((resolve) => setTimeout(resolve, 100))
const filter = await evaluate(`(() => {
  const text = document.body.textContent || ''
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return { label: /活动范围|Activity range/.test(text), all: /不限|Any time/.test(text), one: /1天|1 day/.test(text), fourteen: /14天|14 days/.test(text) }
})()`)
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /任务|Tasks/.test(node.textContent || ''))
  tab?.click()
})()`)
const tasks = await retry(async () => {
  const value = await evaluate(`(() => ({
    cards: document.querySelectorAll('.dbt-task-card').length,
    states: [...document.querySelectorAll('.dbt-task-card')].map((node) => node.dataset.state),
    backgrounds: [...document.querySelectorAll('.dbt-task-card')].map((node) => getComputedStyle(node).backgroundColor),
    projects: [...document.querySelectorAll('.dbt-task-project')].map((node) => node.textContent),
    times: [...document.querySelectorAll('.dbt-task-time')].map((node) => node.textContent),
    runningLines: [...document.querySelectorAll('.dbt-task-card[data-state="running"] .dbt-task-session-line')].map((node) => node.innerHTML),
    dragHandles: document.querySelectorAll('.dbt-task-drag').length,
    draggableCards: document.querySelectorAll('.dbt-task-card[draggable="true"]').length,
    unpinButtons: document.querySelectorAll('.dbt-task-unpin[aria-pressed="true"]').length,
    pinPaths: [...document.querySelectorAll('.dbt-task-unpin svg')].map((node) => [...node.querySelectorAll('path')].map((path) => path.getAttribute('d')).join('|')),
    selectedShadows: [...document.querySelectorAll('.dbt-task-card[data-current="true"]')].map((node) => getComputedStyle(node).boxShadow),
    fullHeight: (() => { const list = document.querySelector('.dbt-task-list'); const view = document.querySelector('.dbt-task-view'); return list && view ? Math.abs(list.getBoundingClientRect().bottom - view.getBoundingClientRect().bottom) < 2 : false })(),
    noHorizontalOverflow: (() => { const list = document.querySelector('.dbt-task-list'); return list ? list.scrollWidth <= list.clientWidth : false })(),
    hasRange: Boolean(document.querySelector('#dbt-activity-range')),
    hasAdd: [...document.querySelectorAll('button')].some((node) => /添加任务|Add task/.test(node.textContent || ''))
  }))()`)
  if (value.cards === 0) throw new Error('pinned cards not loaded')
  return value
})
await evaluate(`(() => {
  const goal = document.querySelector('button[aria-label="展开 Goal"],button[aria-label="Expand Goal"],button[aria-label="收起 Goal"],button[aria-label="Collapse Goal"]')
  const todo = document.querySelector('button[aria-label="展开 Todo"],button[aria-label="Expand Todo"],button[aria-label="收起 Todo"],button[aria-label="Collapse Todo"]')
  if (goal?.getAttribute('aria-expanded') !== 'true') goal?.click()
  if (todo?.getAttribute('aria-expanded') !== 'true') todo?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 100))
const projections = await evaluate(`(() => ({
  details: [...document.querySelectorAll('.dbt-projection-detail')].map((node) => ({ label: node.getAttribute('aria-label'), text: node.textContent })),
  expansionStore: localStorage.getItem('dsh-better-tasks.projection-expansion.v1')
}))()`)
const collapse = await evaluate(`(() => {
  const button = document.querySelector('.dbt-toggle')
  button?.click()
  return Boolean(button)
})()`)
await new Promise((resolve) => setTimeout(resolve, 350))
const rail = await evaluate(`(() => ({
  wide: document.querySelector('.dbt-sidebar')?.dataset.wide,
  width: document.querySelector('.dbt-sidebar')?.getBoundingClientRect().width,
  open: Boolean(document.querySelector('.dbt-toggle .dbt-rail-mark')),
  workspace: Boolean(document.querySelector('.dbt-workspaces'))
}))()`)
await evaluate(`document.querySelector('.dbt-toggle')?.click()`)
await new Promise((resolve) => setTimeout(resolve, 250))
const reopened = await evaluate(`document.querySelector('.dbt-sidebar')?.dataset.wide`)
const report = { native, filter, tasks, projections, collapse, rail, reopened, errors }
console.log(JSON.stringify(report, null, 2))
if (!native.tabMerged || JSON.stringify(native.toggleSize) !== JSON.stringify(['28px', '28px']) || !native.officialPanelIcon || !native.search || !native.addWorkspace) process.exitCode = 2
if (!filter.label || !filter.all || !filter.one || !filter.fourteen) process.exitCode = 3
if (tasks.cards < 1 || tasks.projects.some((value) => !value) || tasks.times.some((value) => !value) || tasks.dragHandles !== 0 || tasks.draggableCards !== tasks.cards || tasks.unpinButtons !== tasks.cards || new Set(tasks.pinPaths).size !== 1 || tasks.selectedShadows.some((value) => value !== 'none') || !tasks.fullHeight || !tasks.noHorizontalOverflow || tasks.hasRange || tasks.hasAdd || tasks.states.some((value) => !['block', 'running', 'idle'].includes(value))) process.exitCode = 4
for (let left = 0; left < tasks.states.length; left += 1) for (let right = left + 1; right < tasks.states.length; right += 1) if (tasks.states[left] !== tasks.states[right] && tasks.backgrounds[left] === tasks.backgrounds[right]) process.exitCode = 4
if (tasks.states.includes('running') && tasks.runningLines.some((html) => !/ongoing|state/i.test(html))) process.exitCode = 5
if (projections.details.length !== 2 || projections.details.some((item) => !item.label) || !projections.expansionStore?.includes(':goal') || !projections.expansionStore?.includes(':todo')) process.exitCode = 6
if (!collapse || rail.wide !== 'false' || rail.width > 80 || !rail.open || !rail.workspace || reopened !== 'true') process.exitCode = 7
if (errors.length > 0) process.exitCode = 8
await send('Page.close').catch(() => {})
socket.close()
