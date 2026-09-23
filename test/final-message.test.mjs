import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveFinalAssistantPreview, createFinalMessageHttpHandler } from '../src/final-message.mjs'

const assistant = (seq, turn, content, extra = {}) => ({
  type: 'assistant/message', seq, time: seq, data: {
    turn,
    step: 1,
    message: { role: 'assistant', content, id: `message-${seq}`, source: { kind: 'model', model: 'test' } },
    stream: [],
    ...extra,
  },
})
const turnEnd = (seq, turn, reason = 'completed') => ({ type: 'turn/end', seq, time: seq, data: { turn, reason } })
const record = (event, surface = 'log-only') => ({ sessionId: 'session-1', seq: event.seq, type: event.type, time: event.time, surface })

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    end(value = '') { this.body += value },
  }
}

test('final preview selects the latest current completed assistant text', () => {
  const events = [
    assistant(0, 1, [{ type: 'text', text: 'older current' }]),
    turnEnd(1, 1),
    assistant(2, 2, [{ type: 'text', text: 'shadowed newer' }]),
    turnEnd(3, 2),
  ]
  const records = [record(events[0], 'current'), record(events[1]), record(events[2], 'shadowed'), record(events[3])]
  assert.deepEqual(deriveFinalAssistantPreview(events, records), {
    asOfSeq: 3,
    final: { seq: 0, turn: 1, text: 'older current', interrupted: false, endReason: 'completed' },
    truncated: false,
    totalCodePoints: 13,
  })
})

test('final preview ignores reasoning-only and unfinished turns', () => {
  const events = [
    assistant(0, 1, [{ type: 'reasoning', text: 'private' }]),
    turnEnd(1, 1),
    assistant(2, 2, [{ type: 'text', text: 'still streaming' }]),
  ]
  const records = events.map((event) => record(event, event.type === 'assistant/message' ? 'current' : 'log-only'))
  assert.deepEqual(deriveFinalAssistantPreview(events, records), { asOfSeq: 2, final: null, truncated: false, totalCodePoints: 0 })
})

test('final preview truncates by Unicode code points and keeps interruption semantics', () => {
  const events = [assistant(0, 1, [{ type: 'text', text: '🙂🙂🙂abc' }], { interrupted: true }), turnEnd(1, 1, 'cancelled')]
  const records = [record(events[0], 'current'), record(events[1])]
  assert.deepEqual(deriveFinalAssistantPreview(events, records, 4), {
    asOfSeq: 1,
    final: { seq: 0, turn: 1, text: '🙂🙂🙂a', interrupted: true, endReason: 'cancelled' },
    truncated: true,
    totalCodePoints: 6,
  })
})

test('final endpoint rejects non-pinned sessions without reading logs', async () => {
  let reads = 0
  const handler = createFinalMessageHttpHandler({ isPinned: () => false, readSession: async () => { reads += 1 } })
  const res = response()
  await handler({ method: 'GET', url: '/api/better-tasks/final-message?sessionId=session-1' }, res)
  assert.equal(res.statusCode, 404)
  assert.equal(reads, 0)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('final endpoint returns only its minimal owned projection', async () => {
  const events = [assistant(0, 1, [{ type: 'text', text: 'done' }]), turnEnd(1, 1)]
  const handler = createFinalMessageHttpHandler({
    isPinned: (id) => id === 'session-1',
    readSession: async () => ({ session: { id: 'session-1', secret: 'not serialized' }, events }),
    buildRecords: (_id, values) => [record(values[0], 'current'), record(values[1])],
  })
  const res = response()
  await handler({ method: 'GET', url: '/api/better-tasks/final-message?sessionId=session-1' }, res)
  const body = JSON.parse(res.body)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(body, {
    sessionId: 'session-1',
    asOfSeq: 1,
    final: { seq: 0, turn: 1, text: 'done', interrupted: false, endReason: 'completed' },
    truncated: false,
    totalCodePoints: 4,
  })
  assert.equal(JSON.stringify(body).includes('secret'), false)
})
