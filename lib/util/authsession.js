var crypto = require('crypto')

var Promise = require('bluebird')

var dbapi = require('../db/api')

var DEFAULT_TTL_SECONDS = 24 * 60 * 60

function ttlSeconds() {
  var configured = parseInt(process.env.SESSION_TTL_SECONDS, 10)
  if (configured && configured > 0) {
    return configured
  }
  return DEFAULT_TTL_SECONDS
}

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

function harden(req) {
  if (!req.sessionOptions) {
    return
  }
  req.sessionOptions.httpOnly = true
  req.sessionOptions.sameSite = 'lax'
  req.sessionOptions.secure = isHttps(req)
  req.sessionOptions.maxAge = ttlSeconds() * 1000
}

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
