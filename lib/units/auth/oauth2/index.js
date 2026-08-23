var http = require('http')

var express = require('express')
var passport = require('passport')
var cookieSession = require('cookie-session')

var logger = require('../../../util/logger')
var authsession = require('../../../util/authsession')
var Strategy = require('./strategy')

const dbapi = require('../../../db/api')

module.exports = function(options) {
  var log = logger.createLogger('auth-oauth2')
  var app = express()
  app.disable('x-powered-by')
  var server = http.createServer(app)

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))

  app.use(function(req, res, next) {
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    next()
  })

  app.get('/auth/contact', function(req, res) {
    dbapi.getRootGroup().then(function(group) {
      res.status(200)
        .json({
          success: true
        , contact: group.owner
        })
    })
    .catch(function(err) {
      log.error('Unexpected error', err.stack)
      res.status(500)
        .json({
          success: false
        , error: 'ServerError'
        })
      })
  })

  function verify(accessToken, refreshToken, profile, done) {
    done(null, profile)
  }

  passport.use(new Strategy(options.oauth, verify))

  app.use(passport.initialize())
  app.use(passport.authenticate('oauth2', {
    failureRedirect: '/auth/oauth/'
  , session: false
  }))

  function isEmailAllowed(email) {
    if (email) {
      if (options.domain) {
        return email.endsWith(options.domain)
      }
      return true
    }
    return false
  }

  app.get(
    '/auth/oauth/callback'
  , function(req, res, next) {
      if (isEmailAllowed(req.user.email)) {
        authsession.establish(req, {
          email: req.user.email
        , name: req.user.email.split('@', 1).join('')
        })
          .then(function() {
            res.redirect(options.appUrl)
          })
          .catch(next)
      }
      else {
        log.warn('Missing or disallowed email in profile', req.user)
        res.render('rejected-email')
      }
    }
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
