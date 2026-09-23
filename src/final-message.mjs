import { buildSessionEventRecords } from '@deepseek-ai/dsh-session-query'

export const FINAL_MESSAGE_MAX_CODE_POINTS = 4000

function codePoints(value) {
  return [...value]
}

export function deriveFinalAssistantPreview(events, records, limit = FINAL_MESSAGE_MAX_CODE_POINTS) {
  if (!Array.isArray(events) || !Array.isArray(records) || events.length !== records.length) {
    throw new TypeError('events and records must be equal-length arrays')
  }
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('limit must be a positive safe integer')

  const endedTurns = new Map()
  for (const event of events) {
    if (event?.type === 'turn/end') endedTurns.set(event.data.turn, event.data.reason)
  }
  const asOfSeq = events.length === 0 ? null : Number(events.at(-1).seq)

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message' || records[index]?.surface !== 'current') continue
    const endReason = endedTurns.get(event.data.turn)
    if (endReason === undefined) continue
    const blocks = Array.isArray(event.data.message?.content) ? event.data.message.content : []
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
      .map((block) => block.text)
      .join('\n')
    if (text === '') continue
    const points = codePoints(text)
    return {
      asOfSeq,
      final: {
        seq: Number(event.seq),
        turn: event.data.turn,
        text: points.slice(0, limit).join(''),
        interrupted: event.data.interrupted === true,
        endReason,
      },
      truncated: points.length > limit,
      totalCodePoints: points.length,
    }
  }

  return { asOfSeq, final: null, truncated: false, totalCodePoints: 0 }
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

export function createFinalMessageHttpHandler({ isPinned, readSession, buildRecords = buildSessionEventRecords }) {
  return async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { code: 'method-not-allowed' })
    const sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')?.trim()
    if (!sessionId || !isPinned(sessionId)) {
      return sendJson(res, 404, { code: 'better-tasks/final-session-not-pinned', message: 'session is not pinned' })
    }
    try {
      const snapshot = await readSession(sessionId)
      const records = buildRecords(sessionId, snapshot.events)
      return sendJson(res, 200, { sessionId, ...deriveFinalAssistantPreview(snapshot.events, records) })
    } catch (error) {
      return sendJson(res, 500, {
        code: 'better-tasks/final-read-failed',
        message: String(error?.message ?? error),
      })
    }
  }
}
