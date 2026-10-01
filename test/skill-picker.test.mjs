import assert from 'node:assert/strict'
import test from 'node:test'
import { insertSkillGesture, listTaskSkills } from '../src/skill-picker.mjs'

test('skill insertion uses official gesture and preserves surrounding Chinese draft', () => {
  assert.deepEqual(insertSkillGesture('前文 后文', 'using-claw-kit', 3, 3),
    { text: '前文 /using-claw-kit 后文', caret: '前文 /using-claw-kit '.length })
  assert.deepEqual(insertSkillGesture('前文待替换后文', 'using-claw-kit', 2, 5),
    { text: '前文 /using-claw-kit 后文', caret: '前文 /using-claw-kit '.length })
  assert.deepEqual(insertSkillGesture('', 'using-claw-kit', 0),
    { text: '/using-claw-kit ', caret: '/using-claw-kit '.length })
  assert.throws(() => insertSkillGesture('hi', '../oops', 2), /invalid skill gesture/)
})

test('skill catalog reads the addressed task Session, not current Session', async () => {
  const seen = []
  const catalog = { list: async (request) => {
    seen.push(request.sessionId)
    return { ok: true, value: { skills: [{ name: `skill-${request.sessionId}`, description: 'ok' }] } }
  } }
  assert.equal((await listTaskSkills(catalog, 'card-a')).at(0).name, 'skill-card-a')
  assert.equal((await listTaskSkills(catalog, 'card-b')).at(0).name, 'skill-card-b')
  assert.deepEqual(seen, ['card-a', 'card-b'])
})

test('skill catalog errors reject without inventing a fallback list', async () => {
  await assert.rejects(listTaskSkills(null, 'card-a'), /unavailable/)
  await assert.rejects(listTaskSkills({ list: async () => ({ ok: false, error: { message: 'offline' } }) }, 'card-a'), /offline/)
  await assert.rejects(listTaskSkills({ list: async () => ({ ok: true, value: {} }) }, 'card-a'), /invalid/)
})
