import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('order restoration and actual legacy import have distinct bilingual status messages', () => {
  const code=readFileSync(new URL('../src/client.js',import.meta.url),'utf8')
  assert.match(code, /'tasks.orderRestoring': '正在恢复任务顺序…'/)
  assert.match(code, /'tasks.orderRestoring': 'Restoring task order…'/)
  const lines=code.split('\n')
  assert.ok(lines.some(line=>line.includes("taskPins.migration === 'initializing'") && line.includes("t('tasks.orderRestoring')")))
  assert.ok(lines.some(line=>line.includes("taskPins.migration === 'running'") && line.includes("t('tasks.pinMigration')")))
  assert.ok(!lines.some(line=>line.includes("['initializing', 'running']") && line.includes("t('tasks.pinMigration')")))
})
