const debuggerBase = process.env.DBT_CDP ?? 'http://127.0.0.1:9224'
const targetUrl = process.env.DBT_URL
if (!targetUrl) throw new Error('DBT_URL is required')
const expectedIds = ['0774a5b6-ca67-4c14-acf8-73168f8e17f8', '3e461774-cb05-46f7-bc06-98d78ed65ba4']

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
  const ready = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.dbt-sidebar'))`)
  if (!ready) throw new Error('sidebar not ready')
})
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /任务|Tasks/.test(node.textContent || ''))
  tab?.click()
})()`)
const initial = await retry(async () => {
  const value = await evaluate(`(() => ({
    cards: document.querySelectorAll('.dbt-task-card').length,
    projects: [...document.querySelectorAll('.dbt-task-project')].map((node) => node.textContent),
    times: [...document.querySelectorAll('.dbt-task-time')].map((node) => node.textContent),
    states: [...document.querySelectorAll('.dbt-task-card')].map((node) => node.dataset.state),
    projectFont: getComputedStyle(document.querySelector('.dbt-task-project')).fontSize,
    hasRange: Boolean(document.querySelector('#dbt-activity-range')),
    hasLegacyGrid: Boolean(document.querySelector('.dbt-task-status-grid,.dbt-task-head')),
    queue: null
  }))()`)
  if (value.cards !== 2) throw new Error(`expected two task cards: ${JSON.stringify(value)}`)
  return value
})

await evaluate(`(() => {
  document.querySelector('button[aria-label="展开 Goal"],button[aria-label="Expand Goal"]')?.click()
  document.querySelector('button[aria-label="展开 Todo"],button[aria-label="Expand Todo"]')?.click()
})()`)
await new Promise((resolve) => setTimeout(resolve, 150))
const projections = await evaluate(`(() => ({
  expanded: document.querySelectorAll('.dbt-projection-detail').length,
  details: [...document.querySelectorAll('.dbt-projection-detail')].map((node) => ({ label: node.getAttribute('aria-label'), text: node.textContent }))
}))()`)

const dragResult = await evaluate(`(async () => {
  const cards = [...document.querySelectorAll('.dbt-task-card')]
  const source = cards[0]
  let target = cards[1]
  if (!source || !target || source.getAttribute('draggable') !== 'true' || document.querySelector('.dbt-task-drag')) return { supported: false }
  const dataTransfer = new DataTransfer()
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  await new Promise((resolve) => setTimeout(resolve, 80))
  target = [...document.querySelectorAll('.dbt-task-card')][1]
  let rect = target.getBoundingClientRect()
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: rect.bottom - 1 }))
  await new Promise((resolve) => setTimeout(resolve, 80))
  target = [...document.querySelectorAll('.dbt-task-card')][1]
  rect = target.getBoundingClientRect()
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: rect.bottom - 1 }))
  await new Promise((resolve) => setTimeout(resolve, 80))
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }))
  await new Promise((resolve) => setTimeout(resolve, 700))
  const response = await fetch('/api/better-tasks/pins', { cache: 'no-store' })
  const payload = await response.json()
  return { supported: true, ids: payload.queue.sessionIds, revision: payload.queue.revision, projects: [...document.querySelectorAll('.dbt-task-project')].map((node) => node.textContent) }
})()`)

const report = { initial, projections, dragResult, errors }
console.log(JSON.stringify(report, null, 2))
if (initial.cards !== 2 || initial.hasRange || initial.hasLegacyGrid || Number.parseFloat(initial.projectFont) < 14 || initial.times.some((value) => !value) || initial.states.some((value) => !['block', 'running', 'idle'].includes(value))) process.exitCode = 2
if (projections.expanded !== 2 || projections.details.some((value) => !value.label)) process.exitCode = 3
if (!dragResult.supported || JSON.stringify(dragResult.ids) !== JSON.stringify([...expectedIds].reverse())) process.exitCode = 4
if (errors.length > 0) process.exitCode = 5
await send('Page.close').catch(() => {})
socket.close()
