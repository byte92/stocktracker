import { logger } from '@/lib/observability/logger'

type FetchLogContext = {
  operation: string
  provider?: string
  resource?: string
  metadata?: Record<string, unknown>
  failureLevel?: 'debug' | 'info' | 'warn' | 'error'
}

const SENSITIVE_QUERY_KEYS = /api[-_]?key|apikey|token|secret|password|access[-_]?key/i

function sanitizeUrl(input: RequestInfo | URL) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  try {
    const url = new URL(raw)
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.set(key, '[redacted]')
    }
    return url.toString()
  } catch {
    return raw
  }
}

function getHost(input: RequestInfo | URL) {
  try {
    return new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).host
  } catch {
    return undefined
  }
}

export async function loggedFetch(input: RequestInfo | URL, init: RequestInit = {}, context: FetchLogContext) {
  const startedAt = Date.now()
  const method = init.method || (typeof input === 'object' && 'method' in input ? input.method : undefined) || 'GET'
  const fields = {
    operation: context.operation,
    provider: context.provider,
    resource: context.resource,
    method,
    host: getHost(input),
    url: sanitizeUrl(input),
    metadata: context.metadata,
  }

  logger.debug('external.fetch.start', fields)

  try {
    const response = await fetch(input, init)
    const durationMs = Date.now() - startedAt
    const endFields = {
      ...fields,
      status: response.status,
      ok: response.ok,
      durationMs,
    }

    if (!response.ok) {
      logger.warn('external.fetch.end', endFields)
    } else {
      logger.debug('external.fetch.end', endFields)
    }
    return response
  } catch (error) {
    const failureFields = {
      ...fields,
      durationMs: Date.now() - startedAt,
      error,
    }
    if (context.failureLevel === 'debug') {
      logger.debug('external.fetch.error', failureFields)
    } else if (context.failureLevel === 'info') {
      logger.info('external.fetch.error', failureFields)
    } else if (context.failureLevel === 'warn') {
      logger.warn('external.fetch.error', failureFields)
    } else {
      logger.error('external.fetch.error', failureFields)
    }
    throw error
  }
}
