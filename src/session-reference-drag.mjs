/** Transient drag transport only. Native session-reference owns citation content. */
export const SESSION_REFERENCE_MIME = 'application/x-dsh-session-reference+json'
const MAX_PAYLOAD_BYTES = 8192

/** File drags always remain owned by native attachment intake. */
export function isSessionReferenceDrag(transfer) {
  const types = Array.from(transfer?.types ?? [])
  return !types.includes('Files') && types.includes(SESSION_REFERENCE_MIME)
}

/** Read only at drop: browsers protect custom data during dragover. */
export function readSessionReferenceDrag(transfer) {
  if (!isSessionReferenceDrag(transfer)) return null
  try {
    const raw = transfer.getData(SESSION_REFERENCE_MIME)
    if (!raw || raw.length > MAX_PAYLOAD_BYTES || new TextEncoder().encode(raw).length > MAX_PAYLOAD_BYTES) return null
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    if (Object.keys(value).length !== 2 || value.version !== 1) return null
    const id = value.sessionId
    if (typeof id !== 'string' || id === '' || id.trim() !== id || /[\u0000-\u001f\u007f]/u.test(id)) return null
    return { version: 1, sessionId: id }
  } catch { return null }
}

/** Publish no title/body and grant no authority; the target resolves native metadata. */
export function writeSessionReferenceDrag(transfer, sessionId, canMove = false) {
  if (!transfer || typeof sessionId !== 'string' || sessionId === '') return false
  const raw = JSON.stringify({ version: 1, sessionId })
  if (new TextEncoder().encode(raw).length > MAX_PAYLOAD_BYTES) return false
  transfer.setData(SESSION_REFERENCE_MIME, raw)
  transfer.setData('text/plain', sessionId)
  transfer.effectAllowed = canMove ? 'copyMove' : 'copy'
  return true
}

/** A move must belong to this owner's active source, never a foreign copy/drop. */
export function matchesSessionReferenceMove(transfer, activeId, permitted = true) {
  return permitted && typeof activeId === 'string' && readSessionReferenceDrag(transfer)?.sessionId === activeId
}
