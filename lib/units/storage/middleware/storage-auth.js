/**
* Selective authentication for the storage routes (/s/download, /s/upload,
* /s/blob).
*
* Two classes of callers are allowed:
*   1. Internal STF services (device workers uploading screenshots, plugins
*      fetching blobs) present a dedicated storage token in the
*      `x-stf-internal-token` header. This token is separate from the JWT
*      signing secret so the two can be rotated independently.
*   2. Browser users present the STF session cookie (`ssid`), which is signed
*      with the JWT secret. A cookie that verifies proves the user logged in.
*
* Anything else (an anonymous external request) is rejected with 401.
*/

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
