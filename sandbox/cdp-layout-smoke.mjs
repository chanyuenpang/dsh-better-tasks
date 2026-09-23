const debuggerBase = process.env.DBT_CDP ?? 'http://127.0.0.1:9224'
const targetUrl = process.env.DBT_URL
const restoreWidth = process.env.DBT_RESTORE_WIDTH === '1'
if (!targetUrl) throw new Error('DBT_URL is required')
async function retry(operation, attempts = 100, delay = 200) {
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
async function ready() {
  await retry(async () => {
    const value = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.dbt-sidebar')) && Boolean(document.querySelector('[data-side="sidebar"]'))`)
    if (!value) throw new Error('layout not ready')
  })
}
async function resizeSidebar(targetWidth) {
  const geometry = await evaluate(`(() => { const sidebar = document.querySelector('.dbt-sidebar').getBoundingClientRect(); const handle = document.querySelector('[data-side="sidebar"]').getBoundingClientRect(); return { width: sidebar.width, x: handle.left + handle.width / 2, y: handle.top + Math.min(160, handle.height / 2) } })()`)
  const targetX = geometry.x + targetWidth - geometry.width
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geometry.x, y: geometry.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: geometry.y, button: 'left', buttons: 1 })
  await new Promise((resolve) => setTimeout(resolve, 80))
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: geometry.y, button: 'left', buttons: 0, clickCount: 1 })
  await new Promise((resolve) => setTimeout(resolve, 180))
  return evaluate(`document.querySelector('.dbt-sidebar').getBoundingClientRect().width`)
}
async function snapshot() {
  return evaluate(`(() => ({
    width: document.querySelector('.dbt-sidebar')?.getBoundingClientRect().width,
    stored: localStorage.getItem('dsh-better-tasks.layout.sidebar-width.v1'),
    columns: document.querySelector('.dbt-task-list')?.dataset.columns,
    collapsed: document.querySelector('.dbt-sidebar')?.dataset.wide === 'false'
  }))()`)
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')])
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: targetUrl })
await ready()
const original = await snapshot()
await evaluate(`localStorage.removeItem('dsh-better-tasks.layout.sidebar-width.v1')`)
await send('Page.reload')
await ready()
await evaluate(`([...document.querySelectorAll('[role="tab"]')].find((node) => /任务|Tasks/.test(node.textContent || '')))?.click()`)
await retry(async () => {
  const found = await evaluate(`Boolean(document.querySelector('.dbt-task-list'))`)
  if (!found) throw new Error('task list not ready')
})
const initial = await snapshot()
const at528Width = await resizeSidebar(528)
const at528 = await snapshot()
const at529Width = await resizeSidebar(529)
const at529 = await snapshot()
const at600Width = await resizeSidebar(600)
const at600 = await snapshot()
await send('Page.reload')
await ready()
await evaluate(`([...document.querySelectorAll('[role="tab"]')].find((node) => /任务|Tasks/.test(node.textContent || '')))?.click()`)
await retry(async () => {
  const found = await evaluate(`Boolean(document.querySelector('.dbt-task-list'))`)
  if (!found) throw new Error('task list not restored')
})
const restored = await snapshot()
const clampedWidth = await resizeSidebar(1200)
const clamped = await snapshot()
await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise((resolve) => setTimeout(resolve, 180))
const dynamicWidth = await resizeSidebar(1200)
const dynamic = await snapshot()
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise((resolve) => setTimeout(resolve, 180))
const narrowed = await snapshot()
await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise((resolve) => setTimeout(resolve, 180))
const widened = await snapshot()
await evaluate(`document.querySelector('.dbt-toggle')?.click()`)
await new Promise((resolve) => setTimeout(resolve, 350))
const collapsed = await snapshot()
await evaluate(`document.querySelector('.dbt-toggle')?.click()`)
await new Promise((resolve) => setTimeout(resolve, 300))
const reopened = await snapshot()
let finalRestored = null
if (restoreWidth) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
  await evaluate(original.stored === null ? `localStorage.removeItem('dsh-better-tasks.layout.sidebar-width.v1')` : `localStorage.setItem('dsh-better-tasks.layout.sidebar-width.v1', ${JSON.stringify(original.stored)})`)
  await send('Page.reload')
  await ready()
  finalRestored = await snapshot()
}

const report = { original, initial, at528Width, at528, at529Width, at529, at600Width, at600, restored, clampedWidth, clamped, dynamicWidth, dynamic, narrowed, widened, collapsed, reopened, finalRestored, errors }
console.log(JSON.stringify(report, null, 2))
const near = (actual, expected) => Math.abs(actual - expected) < 1.1
if (!near(initial.width, 280) || initial.columns !== '1') process.exitCode = 2
if (!near(at528Width, 528) || at528.columns !== '1' || at528.stored !== '528') process.exitCode = 3
if (!near(at529Width, 529) || at529.columns !== '2' || at529.stored !== '529') process.exitCode = 4
if (!near(at600Width, 600) || at600.columns !== '2' || at600.stored !== '600') process.exitCode = 5
if (!near(restored.width, 600) || restored.columns !== '2' || restored.stored !== '600') process.exitCode = 6
if (!near(clampedWidth, 840) || clamped.columns !== '2' || clamped.stored !== '840') process.exitCode = 7
if (!near(dynamicWidth, 1000) || dynamic.stored !== '1000' || dynamic.columns !== '2') process.exitCode = 8
if (!near(narrowed.width, 840) || narrowed.stored !== '1000' || !near(widened.width, 1000) || widened.stored !== '1000') process.exitCode = 9
if (!collapsed.collapsed || Number(collapsed.stored) !== 1000 || !near(reopened.width, 1000) || reopened.columns !== '2') process.exitCode = 10
if (restoreWidth) {
  const expected = original.stored === null ? 280 : Math.min(840, Math.max(264, Number(original.stored)))
  if (!near(finalRestored?.width, expected) || finalRestored?.stored !== original.stored) process.exitCode = 11
}
if (errors.length > 0) process.exitCode = 12
await send('Page.close').catch(() => {})
socket.close()
