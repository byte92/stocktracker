type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogColorMode = 'auto' | 'always' | 'never'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const REDACTED = '[redacted]'
const REDACT_KEYS = /api[-_]?key|authorization|cookie|token|secret|password|access[-_]?key/i
const ANSI_RESET = '\x1b[0m'
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}

type LogFields = Record<string, unknown>

function configuredLevel(): LogLevel | 'silent' {
  const raw = (process.env.APP_LOG_LEVEL || process.env.LOG_LEVEL || '').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') return raw
  if (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test') return 'error'
  if (process.env.NODE_ENV === 'development') return 'debug'
  if (process.env.NODE_ENV === 'production') return 'info'
  return 'info'
}

function configuredColorMode(): LogColorMode {
  const raw = (process.env.APP_LOG_COLOR || process.env.LOG_COLOR || '').toLowerCase()
  if (raw === '1' || raw === 'true' || raw === 'always') return 'always'
  if (raw === '0' || raw === 'false' || raw === 'never') return 'never'
  return 'auto'
}

function shouldLog(level: LogLevel) {
  const current = configuredLevel()
  if (current === 'silent') return false
  return LEVEL_ORDER[level] >= LEVEL_ORDER[current]
}

function shouldColorLog() {
  const mode = configuredColorMode()
  if (mode === 'always') return true
  if (mode === 'never') return false
  if (process.env.NO_COLOR) return false
  return process.env.NODE_ENV === 'development'
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return formatError(value)
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated]` : value
  if (typeof value !== 'object') return value
  if (depth >= 4) return '[max-depth]'

  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1))

  const result: LogFields = {}
  for (const [key, item] of Object.entries(value as LogFields)) {
    result[key] = REDACT_KEYS.test(key) ? REDACTED : sanitize(item, depth + 1)
  }
  return result
}

export function formatError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
}

export function formatLogLine(payload: LogFields, level: LogLevel, color = shouldColorLog()) {
  const line = JSON.stringify(payload)
  if (!color) return line
  return `${LEVEL_COLORS[level]}${line}${ANSI_RESET}`
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}) {
  if (!shouldLog(level)) return

  const sanitizedFields = sanitize(fields) as LogFields
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizedFields,
  }
  const line = formatLogLine(payload, level)

  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else if (level === 'info') {
    console.info(line)
  } else {
    console.debug(line)
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => logEvent('debug', event, fields),
  info: (event: string, fields?: LogFields) => logEvent('info', event, fields),
  warn: (event: string, fields?: LogFields) => logEvent('warn', event, fields),
  error: (event: string, fields?: LogFields) => logEvent('error', event, fields),
}
