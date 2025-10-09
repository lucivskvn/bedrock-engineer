import { setTimeout as delay } from 'node:timers/promises'

/**
 * Detects prototype pollution payloads by scanning objects/arrays for
 * dangerous keys such as `__proto__`, `constructor`, or `prototype`.
 */
export function hasPrototypePollution(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  if (seen.has(value as object)) {
    return false
  }

  seen.add(value as object)

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (hasPrototypePollution(entry, seen)) {
        return true
      }
    }
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype && prototype !== Object.prototype) {
    return true
  }

  for (const key of Reflect.ownKeys(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true
    }

    if (typeof key === 'symbol') {
      // Symbols cannot poison prototypes, but inspect the associated value regardless
      const nestedSymbolValue = (value as Record<symbol, unknown>)[key]
      if (hasPrototypePollution(nestedSymbolValue, seen)) {
        return true
      }
      continue
    }

    const nested = (value as Record<string, unknown>)[key]
    if (hasPrototypePollution(nested, seen)) {
      return true
    }
  }

  return false
}

export type SequentialTask = () => Promise<void> | void

/**
 * Creates a sequential task queue keyed by arbitrary identifiers. Tasks queued
 * with the same key execute strictly one after another regardless of the
 * order they were scheduled. This prevents concurrency issues when handling
 * streaming audio for a specific socket.
 */
export function createSequentialTaskQueue() {
  const queues = new Map<string, Promise<unknown>>()

  return {
    enqueue(key: string, task: SequentialTask): Promise<void> {
      const previous = queues.get(key) ?? Promise.resolve()
      const taskPromise = previous
        .catch(() => undefined)
        .then(async () => {
          await task()
        })

      const trackedPromise = taskPromise.finally(() => {
        if (queues.get(key) === trackedPromise) {
          queues.delete(key)
        }
      })

      queues.set(key, trackedPromise)
      return taskPromise
    },
    clear(key?: string) {
      if (typeof key === 'string') {
        queues.delete(key)
      } else {
        queues.clear()
      }
    },
    size() {
      return queues.size
    }
  }
}

/**
 * Utility helper for tests to await asynchronous execution without introducing
 * busy waiting inside the queue implementation.
 */
export async function flushMicrotasks() {
  await delay(0)
}

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]).toLowerCase() : null
  }
  if (typeof value === 'string') {
    return value.toLowerCase()
  }
  return null
}

const SAFE_FETCH_SITES = new Set(['same-origin', 'same-site', 'none'])
const SAFE_FETCH_MODES = new Set(['cors', 'same-origin'])
const SAFE_FETCH_DESTS = new Set(['', 'empty'])

export function isFetchMetadataRequestSafe({
  method,
  origin,
  secFetchSite,
  secFetchMode,
  secFetchDest,
  allowFileProtocol
}: {
  method: string
  origin?: string | string[]
  secFetchSite?: string | string[]
  secFetchMode?: string | string[]
  secFetchDest?: string | string[]
  allowFileProtocol: boolean
}): { allowed: boolean; reason?: string } {
  const normalizedMode = normalizeHeaderValue(secFetchMode)
  if (normalizedMode && !SAFE_FETCH_MODES.has(normalizedMode)) {
    return {
      allowed: false,
      reason: `Unsupported fetch mode: ${normalizedMode}`
    }
  }

  const normalizedSite = normalizeHeaderValue(secFetchSite)
  if (normalizedSite && !SAFE_FETCH_SITES.has(normalizedSite)) {
    return {
      allowed: false,
      reason: `Unsupported fetch site: ${normalizedSite}`
    }
  }

  const normalizedDest = normalizeHeaderValue(secFetchDest) ?? ''
  if (!SAFE_FETCH_DESTS.has(normalizedDest)) {
    return {
      allowed: false,
      reason: `Unsupported fetch destination: ${normalizedDest}`
    }
  }

  const normalizedOrigin = normalizeHeaderValue(origin)

  if (!allowFileProtocol && normalizedOrigin === 'null') {
    return {
      allowed: false,
      reason: 'Null origin requests are not permitted'
    }
  }

  if (
    allowFileProtocol &&
    normalizedOrigin === 'null' &&
    normalizedDest !== '' &&
    normalizedDest !== 'empty'
  ) {
    return {
      allowed: false,
      reason: 'File protocol requests must use empty destination'
    }
  }

  if (method === 'OPTIONS') {
    return { allowed: true }
  }

  return { allowed: true }
}
