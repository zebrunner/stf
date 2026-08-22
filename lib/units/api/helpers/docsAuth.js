/**
* Authentication gate for the API specification endpoints (SLV-006).
*
* The generated spec serves /swagger.json through the swagger_raw pipe, which
* skips the swagger_security handler, so the whole API definition was readable
* anonymously. This gate runs before the swagger middleware and refuses the
* spec and the Swagger UI unless the caller presents a valid access token or a
* live browser session.
*/
var dbapi = require('../../../db/api')
var jwtutil = require('../../../util/jwtutil')
var logger = require('../../../util/logger')
var authsession = require('../../../util/authsession')

var log = logger.createLogger('api:helpers:docsAuth')

// Matches the spec (/swagger.json) and the Swagger UI docs endpoints (/docs, /api-docs).
var GUARDED = /(?:^|\/)(swagger\.json|api-docs|docs)(?:\/|$)/

function deny(res) {
  return res.status(401).json({
    success: false
  , description: 'Requires Authentication'
  })
}

module.exports = function docsAuth(req, res, next) {
  if (!GUARDED.test(req.path)) {
    return next()
  }

  if (req.headers.authorization) {
    var authHeader = req.headers.authorization.split(' ')
    if (authHeader[0] !== 'Bearer' || !authHeader[1]) {
      return deny(res)
    }
    return dbapi.loadAccessToken(authHeader[1])
      .then(function(token) {
        if (!token || !jwtutil.decode(token.jwt, req.options.secret)) {
          return deny(res)
        }
        next()
      })
      .catch(function(err) {
        log.error('Failed to authorize spec access: ', err.stack)
        return deny(res)
      })
  }

  if (req.session && req.session.jwt) {
    return authsession.isActive(req.session)
      .then(function(active) {
        if (!active) {
          return deny(res)
        }
        next()
      })
      .catch(function(err) {
        log.error('Failed to check session for spec access: ', err.stack)
        return deny(res)
      })
  }

  return deny(res)
}
