var authsession = require('../../../util/authsession')

var dbapi = require('../../../db/api')

module.exports = function(socket, next) {
  var req = socket.request
  var token = req.session.jwt
  if (token) {
    // Refuse cookies whose server-side session was revoked or expired (SLV-004).
    return authsession.isActive(req.session)
      .then(function(active) {
        if (!active) {
          return next(new Error('Session expired'))
        }
        return dbapi.loadUser(token.email)
          .then(function(user) {
            if (user) {
              req.user = user
              next()
            }
            else {
              next(new Error('Invalid user'))
            }
          })
      })
      .catch(next)
  }
  else {
    next(new Error('Missing authorization token'))
  }
}
