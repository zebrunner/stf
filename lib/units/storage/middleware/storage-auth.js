var crypto = require('crypto')
var cookieSession = require('cookie-session')
var logger = require('../../../util/logger')

var log = logger.createLogger('storage:middleware:auth')

module.exports = function storageAuth(options) {
  var secret = options.secret
  var storageToken = options.storageToken

  if (!secret) {
    log.fatal('Storage auth requires a secret but none was configured')
    throw new Error('Storage auth requires a secret')
  }
  if (!storageToken) {
    log.fatal('Storage auth requires a storage token but none was configured')
    throw new Error('Storage auth requires a storage token')
  }

  var expectedToken = Buffer.from(String(storageToken))
  var parseSession = cookieSession({
    name: options.ssid
  , keys: [secret]
  })

  function isInternalCaller(req) {
    var provided = req.headers['x-stf-internal-token']
    if (!provided) {
      return false
    }
    var given = Buffer.from(String(provided))
    if (given.length !== expectedToken.length) {
      return false
    }
    return crypto.timingSafeEqual(given, expectedToken)
  }

  return function(req, res, next) {
    if (isInternalCaller(req)) {
      return next()
    }

    parseSession(req, res, function() {
      if (req.session && req.session.jwt && req.session.jwt.email) {
        return next()
      }
      log.warn(
        'Rejected unauthenticated %s %s from %s'
      , req.method
      , req.originalUrl
      , req.ip
      )
      res.status(401).json({
        success: false
      , error: 'Unauthorized'
      })
    })
  }
}
