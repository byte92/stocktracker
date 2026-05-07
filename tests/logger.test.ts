import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLogLine } from '@/lib/observability/logger'

test('formatLogLine keeps structured logs parseable when color is disabled', () => {
  const line = formatLogLine({ ts: '2026-05-07T00:00:00.000Z', level: 'info', event: 'test.event' }, 'info', false)

  assert.deepEqual(JSON.parse(line), {
    ts: '2026-05-07T00:00:00.000Z',
    level: 'info',
    event: 'test.event',
  })
})

test('formatLogLine applies ANSI color when enabled', () => {
  const line = formatLogLine({ ts: '2026-05-07T00:00:00.000Z', level: 'error', event: 'test.event' }, 'error', true)

  assert.match(line, /^\x1b\[31m/)
  assert.match(line, /\x1b\[0m$/)
  assert.ok(line.includes('"level":"error"'))
})
