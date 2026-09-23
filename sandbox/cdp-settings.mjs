const debuggerBase = process.env.DBT_CDP ?? 'http://127.0.0.1:9224'
const targetUrl = process.env.DBT_URL
if (!targetUrl) throw new Error('DBT_URL is required')

async function retry(operation, attempts = 100, delay = 100) {
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
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text)
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
    const value = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.dbt-sidebar'))`)
    if (!value) throw new Error('sidebar not ready')
  })
}
async function openTaskSettings() {
  await evaluate(`([...document.querySelectorAll('button')].find((node) => /设置|Settings/.test(node.textContent || '') || /设置|Settings/.test(node.getAttribute('aria-label') || '')))?.click()`)
  await retry(async () => {
    const opened = await evaluate(`Boolean([...document.querySelectorAll('button')].find((node) => /任务视图|Task View/.test(node.textContent || '')))`)
    if (!opened) throw new Error('settings navigation not ready')
  })
  await evaluate(`([...document.querySelectorAll('button')].find((node) => /任务视图|Task View/.test(node.textContent || '')))?.click()`)
  await retry(async () => {
    const opened = await evaluate(`Boolean(document.querySelector('.dbt-settings-section'))`)
    if (!opened) throw new Error('Better Tasks settings section not ready')
  })
}
async function snapshot() {
  return evaluate(`(() => ({
    fontOptions: document.querySelectorAll('.dbt-settings-font-option').length,
    selectedFont: document.querySelector('.dbt-settings-font-option[aria-pressed="true"]')?.textContent,
    switches: [...document.querySelectorAll('.dbt-settings-switch')].map((node) => ({ label: node.getAttribute('aria-label'), checked: node.getAttribute('aria-checked') })),
    selectedLayout: document.querySelector('.dbt-settings-segment[aria-pressed="true"]')?.textContent,
    disabled: document.querySelectorAll('.dbt-settings-section button:disabled').length,
  }))()`)
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')])
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: targetUrl })
await ready()
await openTaskSettings()
const before = await snapshot()
await evaluate(`([...document.querySelectorAll('.dbt-settings-font-option')].find((node) => node.textContent === '14px'))?.click()`)
await retry(async () => {
  const selected = await evaluate(`document.querySelector('.dbt-settings-font-option[aria-pressed="true"]')?.textContent`)
  if (selected !== '14px') throw new Error('14px did not become selected')
})
await new Promise((resolve) => setTimeout(resolve, 300))
await send('Page.reload', { ignoreCache: true })
await ready()
await openTaskSettings()
const persisted = await snapshot()
await evaluate(`([...document.querySelectorAll('.dbt-settings-font-option')].find((node) => node.textContent === '13px'))?.click()`)
await retry(async () => {
  const selected = await evaluate(`document.querySelector('.dbt-settings-font-option[aria-pressed="true"]')?.textContent`)
  if (selected !== '13px') throw new Error('13px default was not restored')
})
await new Promise((resolve) => setTimeout(resolve, 300))
const report = { before, persisted, errors }
console.log(JSON.stringify(report, null, 2))
if (before.fontOptions !== 6 || before.switches.length !== 3 || before.disabled !== 0) process.exitCode = 2
if (!before.switches.some((item) => /Goal/.test(item.label) && item.checked === 'false')) process.exitCode = 3
if (persisted.selectedFont !== '14px') process.exitCode = 4
if (errors.length > 0) process.exitCode = 5
await send('Page.close').catch(() => {})
socket.close()
