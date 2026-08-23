/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var authsession = require('../../../util/authsession')

var dbapi = require('../../../db/api')

module.exports = function(options) {
  return function(req, res, next) {
    if (req.session && req.session.jwt) {
      authsession.harden(req)
      authsession.isActive(req.session)
        .then(function(active) {
          if (!active) {
            req.session = null
            res.redirect(options.authUrl)
            return
          }
          return dbapi.loadUser(req.session.jwt.email)
            .then(function(user) {
              if (user) {
                // Continue existing session
                req.user = user
                next()
              }
              else {
                // We no longer have the user in the database
                res.redirect(options.authUrl)
              }
            })
        })
        .catch(next)
    }
    else {
      // No session, forward to auth client
      res.redirect(options.authUrl)
    }
  }
}
