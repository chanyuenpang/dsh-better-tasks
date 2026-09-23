import { writeFile } from 'node:fs/promises'

const debuggerBase = process.env.DBT_CDP ?? 'http://127.0.0.1:9223'
const targetUrl = process.env.DBT_URL
if (!targetUrl) throw new Error('DBT_URL is required')

async function retry(operation, attempts = 80, delay = 250) {
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
  return response.json()
})

const targetResponse = await fetch(`${debuggerBase}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' })
if (!targetResponse.ok) throw new Error(`Cannot create CDP target: ${targetResponse.status}`)
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
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(`exception: ${message.params.exceptionDetails.text}: ${message.params.exceptionDetails.exception?.description ?? ''}`)
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    errors.push(`log: ${message.params.entry.text}`)
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(`console: ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`)
  }
})

function send(method, params = {}) {
  const id = ++sequence
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')])
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const native = await retry(async () => {
  const state = await evaluate(`(() => ({
    ready: document.readyState === 'complete',
    sidebar: Boolean(document.querySelector('.dbt-sidebar')),
    nativeTab: [...document.querySelectorAll('[role="tab"]')].some((node) => /会话|Sessions/.test(node.textContent || '')),
    taskTab: [...document.querySelectorAll('[role="tab"]')].some((node) => /任务|Tasks/.test(node.textContent || '')),
    rootText: document.querySelector('#root')?.textContent?.slice(0, 500) || ''
  }))()`)
  if (!state.ready || !state.sidebar || !state.nativeTab || !state.taskTab) throw new Error(`UI not ready: ${JSON.stringify(state)}`)
  return state
}, 80, 250)

const clicked = await evaluate(`(() => {
  const button = [...document.querySelectorAll('[role="tab"]')].find((node) => /任务|Tasks/.test(node.textContent || ''))
  if (!button) return false
  button.click()
  return true
})()`)
if (!clicked) throw new Error('Task tab is not clickable')
await new Promise((resolve) => setTimeout(resolve, 1000))

const tasks = await evaluate(`(() => ({
  taskView: Boolean(document.querySelector('.dbt-task-view')),
  taskCards: document.querySelectorAll('.dbt-task-card').length,
  maxTen: document.querySelectorAll('.dbt-task-card').length <= 10,
  hasRange: Boolean(document.querySelector('#dbt-activity-range')),
  hasHead: [...document.querySelectorAll('.dbt-task-head span')].map((node) => node.textContent),
  warning: document.querySelector('.dbt-task-warning')?.textContent || null,
  sidebarWidth: document.querySelector('.dbt-sidebar')?.getBoundingClientRect().width || 0
}))()`)

const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile(new URL('./sandbox-task-view.png', import.meta.url), Buffer.from(screenshot.data, 'base64'))

await evaluate(`(() => {
  const button = [...document.querySelectorAll('[role="tab"]')].find((node) => /会话|Sessions/.test(node.textContent || ''))
  button?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 500))
const nativeParity = await evaluate(`(() => ({
  workspaceRegion: Boolean(document.querySelector('.dbt-workspaces')),
  workspaceText: document.querySelector('.dbt-workspaces')?.textContent?.slice(0, 300) || '',
  settings: /设置|Settings/.test(document.querySelector('.dbt-foot')?.textContent || ''),
  newSession: [...document.querySelectorAll('button')].some((node) => /新建会话|New session/.test(node.getAttribute('aria-label') || '')),
  collapse: [...document.querySelectorAll('button')].some((node) => /收起侧边栏|Collapse sidebar/.test(node.getAttribute('aria-label') || ''))
}))()`)

const collapsed = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((node) => /收起侧边栏|Collapse sidebar/.test(node.getAttribute('aria-label') || ''))
  button?.click()
  return Boolean(button)
})()`)
await new Promise((resolve) => setTimeout(resolve, 500))
const rail = await evaluate(`(() => ({
  collapsed: document.querySelector('.dbt-sidebar')?.getAttribute('data-wide') === 'false',
  width: document.querySelector('.dbt-sidebar')?.getBoundingClientRect().width || 0,
  workspaceRegion: Boolean(document.querySelector('.dbt-workspaces')),
  openControl: [...document.querySelectorAll('button')].some((node) => /打开侧边栏|Open sidebar/.test(node.getAttribute('aria-label') || ''))
}))()`)
const railScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile(new URL('./sandbox-rail.png', import.meta.url), Buffer.from(railScreenshot.data, 'base64'))

const report = { native, tasks, nativeParity, collapsed, rail, errors }
console.log(JSON.stringify(report, null, 2))
if (!tasks.taskView || !tasks.maxTen || !tasks.hasRange || tasks.hasHead.length !== 3) process.exitCode = 2
if (!nativeParity.workspaceRegion || !nativeParity.settings || !nativeParity.newSession || !nativeParity.collapse) process.exitCode = 4
if (!collapsed || !rail.collapsed || !rail.workspaceRegion || !rail.openControl || rail.width > 80) process.exitCode = 5
if (errors.length > 0) process.exitCode = 3

await send('Page.close').catch(() => {})
socket.close()
