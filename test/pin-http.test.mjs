import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createPinQueueHttpHandler } from '../src/index.js'
import { applyPinCommand, createEmptyPinQueue } from '../src/pin-model.mjs'

function request(method, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))])
  req.method = method
  return req
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    end(value = '') { this.body += value },
  }
}

function queueHarness() {
  let queue = createEmptyPinQueue('t0')
  const observedPrunes = []
  const handler = createPinQueueHttpHandler({
    current: () => queue,
    eligibleSessionIds: async () => new Set(['ordinary']),
    retainedSessionIds: async () => new Set(['ordinary', 'blank-created']),
    mutate: async (command) => {
      queue = applyPinCommand(queue, command, 't1')
      return queue
    },
    prune: async (eligible) => {
      observedPrunes.push([...eligible])
      return queue
    },
  })
  return { handler, current: () => queue, observedPrunes }
}

test('pin-created is the only command that can pin an eligible blank Session', async () => {
  const harness = queueHarness()
  const rejected = response()
  await harness.handler(request('POST', { action: 'pin', sessionId: 'blank-created', expectedRevision: 0 }), rejected)
  assert.equal(rejected.statusCode, 404)
  assert.deepEqual(harness.current().sessionIds, [])

  const accepted = response()
  await harness.handler(request('POST', { action: 'pin-created', sessionId: 'blank-created', expectedRevision: 0 }), accepted)
  assert.equal(accepted.statusCode, 200)
  assert.deepEqual(harness.current().sessionIds, ['blank-created'])
})

test('GET pruning retains a blank Session admitted by the creation flow', async () => {
  const harness = queueHarness()
  const created = response()
  await harness.handler(request('POST', { action: 'pin-created', sessionId: 'blank-created', expectedRevision: 0 }), created)
  const read = response()
  await harness.handler(request('GET'), read)
  assert.equal(read.statusCode, 200)
  assert.deepEqual(harness.observedPrunes, [['ordinary', 'blank-created']])
  assert.deepEqual(JSON.parse(read.body).queue.sessionIds, ['blank-created'])
})
