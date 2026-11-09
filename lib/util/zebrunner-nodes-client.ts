/**
* Fork (Zebrunner): the client of the internal node routes of the API unit
* (ZEBRUNNER.md#nodes-enrollment), for the units without a database:
* - the triproxies read the CURVE keys of the enrolled nodes (allowed: the active nodes, denied: the
*   revoked nodes and the retired keys) every 5 s for their ZAP handler (lib/util/zmqcurve.ts), and
*   keep the last good set on errors;
* - the storage units check the node tokens of the device units (lib/util/storageauth.ts), cached
*   for 30 s.
* The base URL of the API unit is STF_NODES_API_URL (e.g. http://stf-api:3000); the routes are
* authenticated with the token the server units share, STF_STORAGE_TOKEN, in the
* x-stf-internal-token header.
**/

import logger from './logger.js'
import zebrunnerNodes, {PUBLIC_KEY} from './zebrunner-nodes.js'

const log = logger.createLogger('util:nodes')

export const INTERNAL_TOKEN_HEADER = 'x-stf-internal-token'
export const KEYS_PATH = '/api/v1/zebrunner/nodes/keys'
export const TOKEN_PATH = '/api/v1/zebrunner/nodes/token'
// how often the triproxies read the keys, at most 10 s by the contract
export const KEYS_INTERVAL = 5000
const REQUEST_TIMEOUT = 4000
// how long the storage trusts a checked node token, at most 60 s by the contract
export const TOKEN_TTL = 30000
const REFUSED_TOKEN_TTL = 5000
const TOKEN_CACHE_SIZE = 1000
const ERROR_LOG_INTERVAL = 60 * 1000

export interface NodeKeys {
  allowed: string[]
  denied: string[]
}

type Fetch = typeof fetch

export interface ClientOptions {
  url: string
  token: string
  fetch?: Fetch
}

// apiUrl <env>: the base URL of the API unit of STF_NODES_API_URL, null without one
export function apiUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env.STF_NODES_API_URL || '').trim()
  if (!value) {
    return null
  }
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('STF_NODES_API_URL must be an http(s) URL of the API unit')
  }
  return url.href.replace(/\/+$/, '')
}

// The options of the client of the variables: STF_NODES_API_URL and STF_STORAGE_TOKEN, null without
// both
export function clientOptions(env: NodeJS.ProcessEnv = process.env): ClientOptions | null {
  const url = apiUrl(env)
  if (!url) {
    return null
  }
  if (!env.STF_STORAGE_TOKEN) {
    log.warn(
      'STF_NODES_API_URL needs STF_STORAGE_TOKEN, the token of the server units: the enrolled ' +
      'nodes are ignored'
    )
    return null
  }
  return {url: url, token: env.STF_STORAGE_TOKEN}
}

function keyList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(function(key) {
    return typeof key === 'string' && PUBLIC_KEY.test(key)
  })) {
    throw new Error('Not a list of keys')
  }
  return (value as string[]).map(function(key) {
    return key.toLowerCase()
  })
}

export async function fetchNodeKeys(options: ClientOptions): Promise<NodeKeys> {
  const res = await (options.fetch || fetch)(options.url + KEYS_PATH, {
    headers: {[INTERNAL_TOKEN_HEADER]: options.token}
  , signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const body = await res.json() as {allowed?: unknown, denied?: unknown}
  return {allowed: keyList(body.allowed), denied: keyList(body.denied)}
}

export interface Watcher {
  stop(): void
  // resolves after the next read, for the tests
  poll(): Promise<void>
}

// watchNodeKeys <options> <onKeys>: reads the keys now and every interval; a failed read keeps the
// last keys and is logged once a minute
export function watchNodeKeys(
  options: ClientOptions & {interval?: number}
, onKeys: (keys: NodeKeys) => void
): Watcher {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  let lastError = 0
  let failing = false

  async function poll() {
    try {
      const keys = await fetchNodeKeys(options)
      if (failing) {
        log.info('Reading the keys of the enrolled nodes from %s again', options.url)
        failing = false
      }
      onKeys(keys)
    }
    catch (err) {
      failing = true
      if (Date.now() - lastError >= ERROR_LOG_INTERVAL) {
        lastError = Date.now()
        log.warn(
          'Unable to read the keys of the enrolled nodes from %s (%s), keeping the last ones'
        , options.url
        , (err as Error).message
        )
      }
    }
  }

  function schedule() {
    if (stopped) {
      return
    }
    timer = setTimeout(function() {
      poll().then(schedule)
    }, options.interval || KEYS_INTERVAL)
    timer.unref()
  }

  poll().then(schedule)

  return {
    stop: function() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  , poll: poll
  }
}

interface CachedCheck {
  valid: boolean
  expires: number
}

// createTokenVerifier <options>: checks node tokens with the API unit; a valid one is trusted for
// 30 s, a refused one for 5 s, an error of the API is not cached
export function createTokenVerifier(options: ClientOptions) {
  const cache = new Map<string, CachedCheck>()
  const inflight = new Map<string, Promise<boolean>>()
  let lastError = 0

  async function check(token: string): Promise<boolean> {
    try {
      const res = await (options.fetch || fetch)(options.url + TOKEN_PATH, {
        method: 'POST'
      , headers: {'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: options.token}
      , body: JSON.stringify({token: token})
      , signal: AbortSignal.timeout(REQUEST_TIMEOUT)
      })
      if (res.status !== 200 && res.status !== 403) {
        throw new Error(`HTTP ${res.status}`)
      }
      return res.status === 200
    }
    catch (err) {
      if (Date.now() - lastError >= ERROR_LOG_INTERVAL) {
        lastError = Date.now()
        log.warn('Unable to check a node token with %s (%s)', options.url, (err as Error).message)
      }
      throw err
    }
  }

  return function verify(token: unknown): Promise<boolean> {
    if (!zebrunnerNodes.tokenLabel(token)) {
      return Promise.resolve(false)
    }
    const key = zebrunnerNodes.sha256(token as string)
    const now = Date.now()
    const cached = cache.get(key)
    if (cached && cached.expires > now) {
      return Promise.resolve(cached.valid)
    }
    const running = inflight.get(key)
    if (running) {
      return running
    }
    const result = check(token as string)
      .then(function(valid) {
        if (cache.size >= TOKEN_CACHE_SIZE) {
          cache.forEach(function(entry, other) {
            if (entry.expires <= Date.now()) {
              cache.delete(other)
            }
          })
          if (cache.size >= TOKEN_CACHE_SIZE) {
            cache.clear()
          }
        }
        var ttl = valid ? TOKEN_TTL : REFUSED_TOKEN_TTL
        cache.set(key, {valid: valid, expires: Date.now() + ttl})
        return valid
      }, function() {
        return false
      })
      .finally(function() {
        inflight.delete(key)
      })
    inflight.set(key, result)
    return result
  }
}

export default {apiUrl, clientOptions, createTokenVerifier, fetchNodeKeys, watchNodeKeys}
