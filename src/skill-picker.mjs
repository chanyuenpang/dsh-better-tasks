// The official skill source inserts '/name ' as a plain user-text gesture.
// Keep this contract separate from the command menu and from the textarea UI.
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function insertSkillGesture(draft, name, start, end = start) {
  if (typeof draft !== 'string' || typeof name !== 'string' || !SKILL_NAME.test(name)) {
    throw new TypeError('invalid skill gesture')
  }
  const from = Math.max(0, Math.min(draft.length, Number.isInteger(start) ? start : draft.length))
  const to = Math.max(from, Math.min(draft.length, Number.isInteger(end) ? end : from))
  const before = draft.slice(0, from)
  const after = draft.slice(to)
  const separator = before !== '' && !/\s$/.test(before) ? ' ' : ''
  const gesture = `/${name} `
  return { text: `${before}${separator}${gesture}${after}`, caret: before.length + separator.length + gesture.length }
}

export async function listTaskSkills(catalog, sessionId, signal) {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof catalog?.list !== 'function') {
    throw new TypeError('skill catalog unavailable for session')
  }
  const result = await catalog.list({ sessionId }, signal)
  if (!result?.ok) throw new Error(result?.error?.message ?? 'skills/list failed')
  if (!Array.isArray(result.value?.skills)) throw new TypeError('invalid skills/list response')
  return result.value.skills.filter((skill) => skill && SKILL_NAME.test(skill.name))
}
