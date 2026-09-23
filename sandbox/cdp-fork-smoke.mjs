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
const targetResponse = await fetch(`${debuggerBase}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
if (!targetResponse.ok) throw new Error(`Cannot create target: ${targetResponse.status}`)
const target = await targetResponse.json()
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
    if (waiter !== undefined) {
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

const ready = await retry(async () => {
  const value = await evaluate(`(() => ({
    state: document.readyState,
    sidebar: Boolean(document.querySelector('.dbt-sidebar')),
    workspace: Boolean(document.querySelector('[aria-label="视图选项"], [aria-label="View options"]')),
    tabs: document.querySelectorAll('[role="tab"]').length
  }))()`)
  if (value.state !== 'complete' || !value.sidebar || value.tabs < 2) throw new Error(JSON.stringify(value))
  return value
})
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /会话|Sessions/.test(node.textContent || ''))
  tab?.click()
})()`)
await retry(async () => {
  const visible = await evaluate(`Boolean(document.querySelector('[aria-label="视图选项"], [aria-label="View options"]'))`)
  if (!visible) throw new Error('workspace browser not ready')
})

const shell = await evaluate(`(() => {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]')
  const panel = document.querySelector('.dbt-region-panel')
  const toggle = document.querySelector('.dbt-toggle')
  const selectedStyle = selected ? getComputedStyle(selected) : null
  const panelStyle = panel ? getComputedStyle(panel) : null
  const toggleStyle = toggle ? getComputedStyle(toggle) : null
  return {
    selectedText: selected?.textContent || '',
    selectedBackground: selectedStyle?.backgroundColor || '',
    panelBackground: panelStyle?.backgroundColor || '',
    toggleWidth: toggleStyle?.width || '',
    toggleHeight: toggleStyle?.height || '',
    officialPanelIcon: Boolean(toggle?.querySelector('.dbt-panel-icon'))
  }
})()`)

const menu = await evaluate(`(() => {
  const button = document.querySelector('[aria-label="视图选项"], [aria-label="View options"]')
  button?.click()
  return Boolean(button)
})()`)
if (!menu) throw new Error('View options button missing')
await new Promise((resolve) => setTimeout(resolve, 200))
const activityMenu = await evaluate(`(() => {
  const text = document.body.textContent || ''
  const item = [...document.querySelectorAll('button,[role="menuitem"],[role="option"]')].find((node) => /14天|14 days/.test(node.textContent || ''))
  item?.click()
  return { hasLabel: /活动范围|Activity range/.test(text), hasAll: /不限|Any time/.test(text), has14d: Boolean(item) }
})()`)
await new Promise((resolve) => setTimeout(resolve, 200))
const activitySelection = await evaluate(`localStorage.getItem('dsh.workspace.view.v5') || ''`)
await evaluate(`(() => {
  const button = document.querySelector('[aria-label="视图选项"], [aria-label="View options"]')
  button?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 100))
await evaluate(`(() => {
  const item = [...document.querySelectorAll('button,[role="menuitem"],[role="option"]')].find((node) => /不限|Any time/.test(node.textContent || ''))
  item?.click()
})()`)

await evaluate(`(() => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const button = document.querySelector('[aria-label="视图选项"], [aria-label="View options"]')
  button?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 100))
await evaluate(`(() => {
  const item = [...document.querySelectorAll('button,[role="menuitem"],[role="option"]')].find((node) => /单列表|In one list/.test(node.textContent || ''))
  item?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 400))
const pinBefore = await evaluate(`(() => {
  const button = document.querySelector('button[aria-label="Pin 到任务"],button[aria-label="Pin to tasks"],button[aria-label="从任务移除"],button[aria-label="Remove from tasks"]')
  return button ? { found: true, pressed: button.getAttribute('aria-pressed'), label: button.getAttribute('aria-label') } : {
    found: false,
    buttons: [...document.querySelectorAll('button')].map((node) => node.getAttribute('aria-label')).filter(Boolean).slice(0, 80),
    text: document.querySelector('.dbt-workspaces')?.textContent?.slice(0, 600) || '',
    treeitems: [...document.querySelectorAll('[role="treeitem"]')].slice(0, 5).map((node) => node.outerHTML.slice(0, 500))
  }
})()`)
let pinAfter = null
if (pinBefore.found) {
  await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Pin 到任务"],button[aria-label="Pin to tasks"],button[aria-label="从任务移除"],button[aria-label="Remove from tasks"]')
    button?.click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  pinAfter = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Pin 到任务"],button[aria-label="Pin to tasks"],button[aria-label="从任务移除"],button[aria-label="Remove from tasks"]')
    return button ? { pressed: button.getAttribute('aria-pressed'), label: button.getAttribute('aria-label') } : null
  })()`)
  if (pinAfter?.pressed !== pinBefore.pressed) {
    await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="Pin 到任务"],button[aria-label="Pin to tasks"],button[aria-label="从任务移除"],button[aria-label="Remove from tasks"]')
      button?.click()
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

const report = { ready, shell, activityMenu, activitySelection, pinBefore, pinAfter, errors }
console.log(JSON.stringify(report, null, 2))
if (shell.selectedBackground !== shell.panelBackground || shell.toggleWidth !== '28px' || shell.toggleHeight !== '28px' || !shell.officialPanelIcon) process.exitCode = 2
if (!activityMenu.hasLabel || !activityMenu.hasAll || !activityMenu.has14d || !activitySelection.includes('14d')) process.exitCode = 3
if (pinBefore.found && pinAfter?.pressed === pinBefore.pressed) process.exitCode = 4
if (errors.length > 0) process.exitCode = 5
await send('Page.close').catch(() => {})
socket.close()
