export const PIN_QUEUE_SCHEMA_VERSION = 1
export const PIN_QUEUE_KEY = 'global'

export class PinQueueError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'PinQueueError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function createEmptyPinQueue(now = new Date().toISOString()) {
  return Object.freeze({
    schemaVersion: PIN_QUEUE_SCHEMA_VERSION,
    revision: 0,
    sessionIds: Object.freeze([]),
    updatedAt: now,
  })
}

function requireRecord(record) {
  if (record === null || typeof record !== 'object' || record.schemaVersion !== PIN_QUEUE_SCHEMA_VERSION) {
    throw new PinQueueError('better-tasks/invalid-record', 'pin queue record is invalid')
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0 || !Array.isArray(record.sessionIds)) {
    throw new PinQueueError('better-tasks/invalid-record', 'pin queue record is invalid')
  }
  return record
}

function requireCommand(command) {
  if (command === null || typeof command !== 'object') {
    throw new PinQueueError('better-tasks/invalid-request', 'pin command must be an object')
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw new PinQueueError('better-tasks/invalid-request', 'expectedRevision must be a non-negative safe integer')
  }
  if (!['pin', 'pin-created', 'unpin', 'move'].includes(command.action)) {
    throw new PinQueueError('better-tasks/invalid-request', 'action must be pin, pin-created, unpin, or move')
  }
  if (typeof command.sessionId !== 'string' || command.sessionId.length === 0) {
    throw new PinQueueError('better-tasks/invalid-request', 'sessionId must be a non-empty string')
  }
  if (command.beforeSessionId !== undefined && command.beforeSessionId !== null &&
      (typeof command.beforeSessionId !== 'string' || command.beforeSessionId.length === 0)) {
    throw new PinQueueError('better-tasks/invalid-request', 'beforeSessionId must be a non-empty string or null')
  }
  return command
}

function changedRecord(current, sessionIds, now) {
  return Object.freeze({
    schemaVersion: PIN_QUEUE_SCHEMA_VERSION,
    revision: current.revision + 1,
    sessionIds: Object.freeze(sessionIds),
    updatedAt: now,
  })
}

export function applyPinCommand(record, input, now = new Date().toISOString()) {
  const current = requireRecord(record)
  const command = requireCommand(input)
  if (command.expectedRevision !== current.revision) {
    throw new PinQueueError('better-tasks/revision-conflict', 'pin queue revision changed', {
      expectedRevision: command.expectedRevision,
      actualRevision: current.revision,
    })
  }

  const sessionIds = [...current.sessionIds]
  const index = sessionIds.indexOf(command.sessionId)
  if (command.action === 'pin' || command.action === 'pin-created') {
    if (index !== -1) return current
    return changedRecord(current, [...sessionIds, command.sessionId], now)
  }
  if (command.action === 'unpin') {
    if (index === -1) return current
    sessionIds.splice(index, 1)
    return changedRecord(current, sessionIds, now)
  }
  if (index === -1) {
    throw new PinQueueError('better-tasks/not-pinned', `session is not pinned: ${command.sessionId}`)
  }

  const without = sessionIds.filter((id) => id !== command.sessionId)
  const before = command.beforeSessionId ?? null
  if (before === command.sessionId) return current
  if (before === null) {
    without.push(command.sessionId)
  } else {
    const beforeIndex = without.indexOf(before)
    if (beforeIndex === -1) {
      throw new PinQueueError('better-tasks/anchor-not-pinned', `move anchor is not pinned: ${before}`)
    }
    without.splice(beforeIndex, 0, command.sessionId)
  }
  if (without.every((id, nextIndex) => id === sessionIds[nextIndex])) return current
  return changedRecord(current, without, now)
}

export function prunePinQueue(record, eligibleSessionIds, now = new Date().toISOString()) {
  const current = requireRecord(record)
  const eligible = eligibleSessionIds instanceof Set ? eligibleSessionIds : new Set(eligibleSessionIds)
  const sessionIds = current.sessionIds.filter((id) => eligible.has(id))
  if (sessionIds.length === current.sessionIds.length) return current
  return changedRecord(current, sessionIds, now)
}

export function publicPinQueue(record) {
  const current = requireRecord(record)
  return {
    schemaVersion: current.schemaVersion,
    revision: current.revision,
    sessionIds: [...current.sessionIds],
    updatedAt: current.updatedAt,
  }
}
