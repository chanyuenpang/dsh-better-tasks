const debuggerBase = process.env.DBT_CDP ?? 'http://127.0.0.1:9224'
const targetUrl = process.env.DBT_URL
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
    const found = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.dbt-sidebar'))`)
    if (!found) throw new Error('sidebar not ready')
  })
}
async function resizeSidebar(targetWidth) {
  const geometry = await evaluate(`(() => { const sidebar = document.querySelector('.dbt-sidebar').getBoundingClientRect(); const handle = document.querySelector('[data-side="sidebar"]').getBoundingClientRect(); return { width: sidebar.width, x: handle.left + handle.width / 2, y: handle.top + Math.min(160, handle.height / 2) } })()`)
  const targetX = geometry.x + targetWidth - geometry.width
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geometry.x, y: geometry.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: geometry.y, button: 'left', buttons: 1 })
  await new Promise((resolve) => setTimeout(resolve, 80))
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: geometry.y, button: 'left', buttons: 0, clickCount: 1 })
  await new Promise((resolve) => setTimeout(resolve, 150))
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')])
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: targetUrl })
await ready()
await evaluate(`([...document.querySelectorAll('[role="tab"]')].find((node) => /任务|Tasks/.test(node.textContent || '')))?.click()`)
await retry(async () => {
  const count = await evaluate(`document.querySelectorAll('.dbt-task-card').length`)
  if (count < 2) throw new Error('need at least two task cards')
})
await resizeSidebar(600)
await retry(async () => {
  const columns = await evaluate(`document.querySelectorAll('.dbt-task-column').length`)
  if (columns !== 2) throw new Error('two independent columns not ready')
})
const unpinBefore = await evaluate(`(() => { const button = document.querySelector('.dbt-task-unpin'); const r = button.getBoundingClientRect(); return { opacity: getComputedStyle(button).opacity, width: r.width, height: r.height } })()`)
const cardPoint = await evaluate(`(() => { const r = document.querySelector('.dbt-task-card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardPoint.x, y: cardPoint.y })
await new Promise((resolve) => setTimeout(resolve, 180))
const unpinAfter = await evaluate(`getComputedStyle(document.querySelector('.dbt-task-unpin')).opacity`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1590, y: 890 })
const before = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.dbt-task-card')]
  const current = cards.find((card) => card.dataset.current === 'true')?.dataset.sessionId ?? null
  return { current, target: cards.find((card) => card.dataset.current !== 'true')?.dataset.sessionId ?? null }
})()`)
if (!before.target) throw new Error('no non-current task card')
const actionGuard = await evaluate(`(() => {
  const card = document.querySelector('.dbt-task-card[data-session-id="${before.target}"]')
  const toggle = card?.querySelector('.dbt-projection-toggle')
  if (!card || !toggle) return { found: false }
  const wasCurrent = card.dataset.current
  toggle.click()
  return { found: true, wasCurrent, currentAfter: card.dataset.current, expanded: toggle.getAttribute('aria-expanded') }
})()`)
await new Promise((resolve) => setTimeout(resolve, 100))
const actionCurrentAfter = await evaluate(`document.querySelector('.dbt-task-card[data-session-id="${before.target}"]')?.dataset.current`)
const projectionDisabled = await evaluate(`(() => ({
  disabled: document.querySelectorAll('.dbt-projection-toggle:disabled').length,
  enabled: [...document.querySelectorAll('.dbt-projection-toggle:not(:disabled)')].filter((button) => /Goal|Todo/.test(button.getAttribute('aria-label') || '')).length
}))()`)
const finalSetup = await evaluate(`(() => {
  const card = document.querySelector('.dbt-task-card[data-state="idle"]')
  const toggle = [...(card?.querySelectorAll('.dbt-projection-toggle') ?? [])].find((button) => /Final/.test(button.getAttribute('aria-label') || ''))
  if (!card || !toggle) return null
  const currentBefore = card.dataset.current
  const wasExpanded = toggle.getAttribute('aria-expanded') === 'true'
  if (!wasExpanded) toggle.click()
  return { id: card.dataset.sessionId, currentBefore, wasExpanded }
})()`)
if (!finalSetup) throw new Error('idle Final toggle not found')
await retry(async () => {
  const value = await evaluate(`(() => { const card = document.querySelector('.dbt-task-card[data-session-id="${finalSetup.id}"]'); const detail = [...(card?.querySelectorAll('.dbt-projection-detail') ?? [])].find((node) => node.getAttribute('aria-label') === 'Final'); return detail?.textContent || '' })()`)
  if (!value || /正在读取|Loading/.test(value)) throw new Error('Final message still loading')
})
const finalResult = await evaluate(`(() => { const card = document.querySelector('.dbt-task-card[data-session-id="${finalSetup.id}"]'); const detail = [...card.querySelectorAll('.dbt-projection-detail')].find((node) => node.getAttribute('aria-label') === 'Final'); return { text: detail?.textContent || '', currentAfter: card.dataset.current } })()`)
await evaluate(`document.querySelector('.dbt-task-card[data-session-id="${before.target}"]')?.click()`)
await retry(async () => {
  const current = await evaluate(`document.querySelector('.dbt-task-card[data-session-id="${before.target}"]')?.dataset.current`)
  if (current !== 'true') throw new Error('whole-card click did not select session')
})
if (before.current) {
  await evaluate(`document.querySelector('.dbt-task-card[data-session-id="${before.current}"]')?.click()`)
  await retry(async () => {
    const current = await evaluate(`document.querySelector('.dbt-task-card[data-session-id="${before.current}"]')?.dataset.current`)
    if (current !== 'true') throw new Error('failed to restore previous selected session')
  })
}
const dragGuard = await evaluate(`(() => {
  const card = document.querySelector('.dbt-task-card[data-session-id="${before.target}"]')
  const currentBefore = card.dataset.current
  const transfer = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
  card.click()
  return { currentBefore, currentAfter: card.dataset.current }
})()`)
await new Promise((resolve) => setTimeout(resolve, 100))
const appearance = await evaluate(`fetch('/api/project-appearance', { cache: 'no-store' }).then(async (response) => { const body = await response.json(); return { ok: response.ok, items: body.items?.length ?? -1, icons: body.icons?.length ?? -1, revision: body.catalogRevision } })`)
const geometry = await evaluate(`(() => ({
  columns: [...document.querySelectorAll('.dbt-task-column')].map((column) => [...column.children].map((card) => { const r = card.getBoundingClientRect(); return { id: card.dataset.sessionId, top: r.top, bottom: r.bottom, left: r.left, cursor: getComputedStyle(card).cursor } })),
  overflowX: document.querySelector('.dbt-task-list').scrollWidth - document.querySelector('.dbt-task-list').clientWidth,
  dragIcons: document.querySelectorAll('.dbt-task-drag').length
}))()`)
const contiguous = geometry.columns.every((column) => column.length < 2 || Math.abs(column[1].top - column[0].bottom - 7) < 1.1)
const cursors = geometry.columns.flat().map((card) => card.cursor)
const report = { appearance, unpinBefore, unpinAfter, before, actionGuard, actionCurrentAfter, projectionDisabled, finalSetup, finalResult, dragGuard, geometry, contiguous, cursors, errors }
console.log(JSON.stringify(report, null, 2))
if (!actionGuard.found || actionCurrentAfter !== 'false') process.exitCode = 2
if (dragGuard.currentAfter !== dragGuard.currentBefore) process.exitCode = 3
if (!contiguous || geometry.columns.length !== 2 || geometry.columns.some((column) => column.length === 0)) process.exitCode = 4
if (cursors.some((cursor) => cursor === 'grab' || cursor === 'grabbing') || geometry.dragIcons !== 0) process.exitCode = 5
if (geometry.overflowX > 1 || errors.length > 0) process.exitCode = 6
if (unpinBefore.opacity !== '0' || unpinBefore.width !== 24 || unpinBefore.height !== 24 || Number(unpinAfter) < 0.95) process.exitCode = 7
if (!appearance.ok || appearance.icons < 100 || appearance.revision !== 'tabler-3.44.0-r2') process.exitCode = 8
if (projectionDisabled.disabled < 1 || finalResult.currentAfter !== finalSetup.currentBefore || /读取失败|Failed/.test(finalResult.text)) process.exitCode = 9
await send('Page.close').catch(() => {})
socket.close()
