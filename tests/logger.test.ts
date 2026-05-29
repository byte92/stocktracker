import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { formatLogLine, logEvent } from '@/lib/observability/logger'

test('formatLogLine keeps structured logs parseable as one JSONL record', () => {
  const line = formatLogLine({ ts: '2026-05-07T00:00:00.000Z', level: 'info', event: 'test.event' })

  assert.deepEqual(JSON.parse(line), {
    ts: '2026-05-07T00:00:00.000Z',
    level: 'info',
    event: 'test.event',
  })
})

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (fs.existsSync(filePath)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('logEvent appends JSONL records when APP_LOG_FILE is configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-logs-'))
  const logFile = path.join(dir, 'app.jsonl')
  const originalLogFile = process.env.APP_LOG_FILE
  const originalConsoleError = console.error
  const consoleLines: string[] = []

  process.env.APP_LOG_FILE = logFile
  console.error = (line?: unknown) => {
    consoleLines.push(String(line))
  }

  try {
    logEvent('error', 'test.fileLog', { token: 'secret-token', nested: { count: 1 } })
    await waitForFile(logFile)
  } finally {
    if (originalLogFile === undefined) {
      delete process.env.APP_LOG_FILE
    } else {
      process.env.APP_LOG_FILE = originalLogFile
    }
    console.error = originalConsoleError
  }

  const records = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n')
  assert.equal(records.length, 1)
  assert.ok(consoleLines.some((line) => line.includes('"event":"test.fileLog"')))

  const parsed = JSON.parse(records[0]!)
  assert.equal(parsed.level, 'error')
  assert.equal(parsed.event, 'test.fileLog')
  assert.equal(parsed.token, '[redacted]')
  assert.deepEqual(parsed.nested, { count: 1 })
})
