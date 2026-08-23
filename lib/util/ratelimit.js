var DEFAULTS = {
  windowMs: 3 * 60 * 1000
, maxAttempts: 5
, lockoutMs: 3 * 60 * 1000
, delayAfter: 3
, delayStepMs: 500
, maxDelayMs: 5000
}

function envInt(name, fallback, asSeconds) {
  var raw = parseInt(process.env[name], 10)
  if (raw && raw > 0) {
    return asSeconds ? raw * 1000 : raw
  }
  return fallback
}

function resolveConfig(options) {
  options = options || {}
  return {
    windowMs: options.windowMs ||
      envInt('STF_AUTH_WINDOW_SECONDS', DEFAULTS.windowMs, true)
  , maxAttempts: options.maxAttempts ||
      envInt('STF_AUTH_MAX_ATTEMPTS', DEFAULTS.maxAttempts, false)
  , lockoutMs: options.lockoutMs ||
      envInt('STF_AUTH_LOCKOUT_SECONDS', DEFAULTS.lockoutMs, true)
  , delayAfter: options.delayAfter || DEFAULTS.delayAfter
  , delayStepMs: options.delayStepMs || DEFAULTS.delayStepMs
  , maxDelayMs: options.maxDelayMs || DEFAULTS.maxDelayMs
  }
}

function clientIp(req) {
  var xff = req.headers && req.headers['x-forwarded-for']
  if (xff) {
    return String(xff).split(',')[0].trim()
  }
  return req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    'unknown'
}

function accountId(req) {
  var body = req.body || {}
  return String(body.username || body.email || body.name || '')
    .trim()
    .toLowerCase()
}

module.exports = function(options) {
  var config = resolveConfig(options)
  var store = Object.create(null)

  function prune(now) {
    Object.keys(store).forEach(function(key) {
      var state = store[key]
      var idle = (!state.lockedUntil || state.lockedUntil <= now) &&
        state.windowResetAt <= now &&
        state.fails === 0
      if (idle) {
        delete store[key]
      }
    })
  }

  function get(key, now) {
    var state = store[key]
    if (!state) {
      state = store[key] = {
        fails: 0
      , windowResetAt: now + config.windowMs
      , lockedUntil: 0
      , lockLevel: 0
      }
    }
    var unlocked = !state.lockedUntil || state.lockedUntil <= now
    if (unlocked && state.windowResetAt <= now) {
      state.fails = 0
      state.windowResetAt = now + config.windowMs
    }
    return state
  }

  function lockedSeconds(key, now) {
    var state = store[key]
    if (state && state.lockedUntil && state.lockedUntil > now) {
      return Math.ceil((state.lockedUntil - now) / 1000)
    }
    return 0
  }

  function registerFailure(key, now) {
    var state = get(key, now)
    state.fails += 1
    if (state.fails >= config.maxAttempts) {
      state.lockLevel += 1
      var backoff = config.lockoutMs * Math.pow(2, state.lockLevel - 1)
      state.lockedUntil = now + backoff
      state.fails = 0
      state.windowResetAt = state.lockedUntil
    }
  }

  function clear(key) {
    delete store[key]
  }

  function delayFor(key) {
    var state = store[key]
    if (!state || state.fails < config.delayAfter) {
      return 0
    }
    var steps = state.fails - config.delayAfter + 1
    return Math.min(config.maxDelayMs, steps * config.delayStepMs)
  }

  return function(req, res, next) {
    var now = Date.now()
    prune(now)

    var keys = ['ip:' + clientIp(req)]
    var account = accountId(req)
    if (account) {
      keys.push('acct:' + account)
    }

    var wait = 0
    keys.forEach(function(key) {
      wait = Math.max(wait, lockedSeconds(key, now))
    })
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait))
      return res.status(429).json({
        success: false
      , error: 'TooManyRequestsError'
      , retryAfter: wait
      })
    }

    var originalJson = res.json.bind(res)
    var settled = false
    res.json = function(body) {
      if (settled) {
        return originalJson(body)
      }
      settled = true

      var success = body && body.success === true
      if (success) {
        keys.forEach(clear)
        return originalJson(body)
      }

      var when = Date.now()
      if (res.statusCode >= 400 && res.statusCode !== 429) {
        keys.forEach(function(key) {
          registerFailure(key, when)
        })
      }

      var delay = 0
      keys.forEach(function(key) {
        delay = Math.max(delay, delayFor(key))
      })
      if (delay > 0) {
        setTimeout(function() {
          originalJson(body)
        }, delay)
        return res
      }
      return originalJson(body)
    }

    next()
  }
}
