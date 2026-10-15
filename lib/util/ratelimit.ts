/**
* Fork (Zebrunner): limits the failed sign-ins of an auth unit, ported from stf-platform-enhancement.
*
* The failures (4xx answers) are counted per user name (or email) and client address: after maxAttempts failed
* sign-ins within window, the next ones are refused with 429 for lockout, doubled with every lock
* up to maxLockout. A successful sign-in clears the count. The client address is req.ip, so a
* client cannot pick it with X-Forwarded-For; behind a proxy that does not pass it on, all clients
* share the address and the limit is per user.
**/

import type express from 'express'

export interface RateLimitOptions {
  window?: number
  maxAttempts?: number
  lockout?: number
  maxLockout?: number
}

interface Attempts {
  failures: number
  windowEnds: number
  lockedUntil: number
  locks: number
}

const DEFAULTS = {
  window: 3 * 60 * 1000
, maxAttempts: 5
, lockout: 3 * 60 * 1000
, maxLockout: 30 * 60 * 1000
}

function account(req: express.Request): string {
  var body = (req.body || {}) as Record<string, unknown>
  return String(body.username || body.email || body.name || '').trim().toLowerCase()
}

export default function ratelimit(options: RateLimitOptions = {}): express.RequestHandler {
  var config = Object.assign({}, DEFAULTS, options)
  var attempts = new Map<string, Attempts>()

  function prune(now: number) {
    attempts.forEach(function(state, key) {
      if (state.lockedUntil <= now && state.windowEnds <= now) {
        attempts.delete(key)
      }
    })
  }

  function fail(key: string, now: number) {
    var state = attempts.get(key)
    if (!state || (state.windowEnds <= now && state.lockedUntil <= now)) {
      state = {
        failures: 0
      , windowEnds: now + config.window
      , lockedUntil: 0
      , locks: state?.locks || 0
      }
      attempts.set(key, state)
    }
    state.failures += 1
    if (state.failures >= config.maxAttempts) {
      var lock = Math.min(config.maxLockout, config.lockout * Math.pow(2, state.locks))
      state.locks += 1
      state.failures = 0
      state.lockedUntil = now + lock
      state.windowEnds = state.lockedUntil + config.window
    }
  }

  return function(req, res, next) {
    var now = Date.now()
    prune(now)
    var key = req.ip + '|' + account(req)
    var state = attempts.get(key)

    if (state && state.lockedUntil > now) {
      var wait = Math.ceil((state.lockedUntil - now) / 1000)
      res.setHeader('Retry-After', String(wait))
      res.status(429).json({success: false, error: 'TooManyRequestsError', retryAfter: wait})
      return
    }

    res.on('finish', function() {
      if (res.statusCode < 400) {
        attempts.delete(key)
      }
      // Only refused credentials count, an unreachable identity service must not lock anybody out
      else if (res.statusCode < 500 && res.statusCode !== 429) {
        fail(key, Date.now())
      }
    })
    next()
  }
}
