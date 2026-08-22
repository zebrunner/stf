/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var http = require('http')

var express = require('express')
var validator = require('express-validator')
var cookieSession = require('cookie-session')
var bodyParser = require('body-parser')
var serveStatic = require('serve-static')
var csrf = require('csurf')
var Promise = require('bluebird')

var logger = require('../../util/logger')
var requtil = require('../../util/requtil')
var ldaputil = require('../../util/ldaputil')
var pathutil = require('../../util/pathutil')
var lifecycle = require('../../util/lifecycle')
var authsession = require('../../util/authsession')
var ratelimit = require('../../util/ratelimit')

const dbapi = require('../../db/api')

module.exports = function(options) {
  var log = logger.createLogger('auth-ldap')
  var app = express()
  app.disable('x-powered-by')
  var server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/ldap/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  // Honour the edge X-Forwarded-Proto so the session cookie gets Secure over TLS (SLV-003).
  app.set('trust proxy', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use(validator())
  app.use('/static/bower_components',
    serveStatic(pathutil.resource('bower_components')))
  app.use('/static/auth/ldap', serveStatic(pathutil.resource('auth/ldap')))

  app.use(function(req, res, next) {
    res.setHeader('Referrer-Policy', 'no-referrer')
    // Refuse framing so the login page cannot be clickjacked (SLV-008).
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.get('/', function(req, res) {
    res.redirect('/auth/ldap/')
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

  app.get('/auth/ldap/', function(req, res) {
    res.render('index')
  })

  // Throttle and lock out repeated failed logins before they reach LDAP (SLV-005).
  app.post('/auth/api/v1/ldap', ratelimit(), function(req, res) {
    var log = logger.createLogger('auth-ldap')
    log.setLocalIdentifier(req.ip)
    switch (req.accepts(['json'])) {
      case 'json':
        requtil.validate(req, function() {
            req.checkBody('username').notEmpty()
            req.checkBody('password').notEmpty()
          })
          .then(function() {
            return ldaputil.login(
              options.ldap
            , req.body.username
            , req.body.password
            )
          })
          .then(function(user) {
            log.info('Authenticated "%s"', ldaputil.email(user))
            // Establish the session in the shared `ssid` cookie and hand back a
            // clean URL so the token never travels in the redirect (SLV-003).
            return authsession.establish(req, {
              email: ldaputil.email(user)
            , name: user[options.ldap.username.field]
            })
            .then(function() {
              res.status(200)
                .json({
                  success: true
                , redirect: options.appUrl
                })
            })
          })
          .catch(requtil.ValidationError, function(err) {
            res.status(400)
              .json({
                success: false
              , error: 'ValidationError'
              , validationErrors: err.errors
              })
          })
          .catch(ldaputil.InvalidCredentialsError, function(err) {
            log.warn('Authentication failure for "%s"', err.user)
            res.status(400)
              .json({
                success: false
              , error: 'InvalidCredentialsError'
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
        break
      default:
        res.send(406)
        break
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
