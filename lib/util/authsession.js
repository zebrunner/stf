/**
* Auth session handoff + server-side lifecycle helper (SLV-003, SLV-004).
*
* Establishes the STF browser session through the signed `ssid` cookie that the
* auth, app, api, and websocket units already share, so the JWT never travels in
* a redirect URL (SLV-003). Each session also carries a server-side id recorded
* in the `sessions` table, so logout (or expiry) revokes it and a replayed cookie
* is refused afterwards (SLV-004).
*/
var crypto = require('crypto')

var Promise = require('bluebird')

var dbapi = require('../db/api')

var DEFAULT_TTL_SECONDS = 24 * 60 * 60

// ttlSeconds is the server-side session lifetime, overridable via env.
function ttlSeconds() {
  var configured = parseInt(process.env.SESSION_TTL_SECONDS, 10)
  if (configured && configured > 0) {
    return configured
  }
  return DEFAULT_TTL_SECONDS
}

// isHttps reports whether the external client request arrived over TLS. The
// edge proxy terminates TLS, so honour X-Forwarded-Proto as well as req.secure.
function isHttps(req) {
  if (req.secure) {
    return true
  }
  var proto = req.headers && req.headers['x-forwarded-proto']
  if (!proto) {
    return false
  }
  return String(proto).split(',')[0].trim().toLowerCase() === 'https'
}

// harden pins the session cookie to same-site, browser-only use, marks it Secure
// over TLS, and bounds its lifetime.
function harden(req) {
  if (!req.sessionOptions) {
    return
  }
  req.sessionOptions.httpOnly = true
  req.sessionOptions.sameSite = 'lax'
  req.sessionOptions.secure = isHttps(req)
  req.sessionOptions.maxAge = ttlSeconds() * 1000
}

// establish records the identity in the shared session cookie, persists the
// login, and registers a revocable server-side session. Returns a promise so
// callers redirect only once the session row exists.
function establish(req, identity) {
  var sid = crypto.randomBytes(18).toString('hex')
  req.session.jwt = {
    email: identity.email
  , name: identity.name
  , sid: sid
  }
  harden(req)
  return dbapi.saveUserAfterLogin({
    name: identity.name
  , email: identity.email
  , ip: req.ip
  })
  .then(function() {
    return dbapi.saveSession({
      id: sid
    , email: identity.email
    , ttlSeconds: ttlSeconds()
    })
  })
}

// isActive resolves true only when the cookie maps to a live, unexpired
// server-side session. Expired rows are pruned best-effort.
function isActive(session) {
  if (!session || !session.jwt || !session.jwt.sid) {
    return Promise.resolve(false)
  }
  var sid = session.jwt.sid
  return dbapi.loadSession(sid).then(function(row) {
    if (!row) {
      return false
    }
    var expireAt = row.expireAt ? new Date(row.expireAt).getTime() : 0
    if (expireAt && expireAt <= Date.now()) {
      dbapi.deleteSession(sid).catch(function() {})
      return false
    }
    return true
  })
}

// revoke terminates the server-side session behind a cookie (logout).
function revoke(session) {
  if (!session || !session.jwt || !session.jwt.sid) {
    return Promise.resolve()
  }
  return dbapi.deleteSession(session.jwt.sid)
}

module.exports.ttlSeconds = ttlSeconds
module.exports.isHttps = isHttps
module.exports.harden = harden
module.exports.establish = establish
module.exports.isActive = isActive
module.exports.revoke = revoke
