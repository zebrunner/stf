/**
* Copyright © 2019-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import crypto from 'crypto'
import http from 'http'

import express from 'express'
import bodyParser from 'body-parser'
import serveStatic from 'serve-static'
// csurf exports the middleware factory directly up to 1.15.0 and as an ESM
// default from 1.16.1 on. Accept both, the declared range allows both.
import * as csurf from '@dr.pogodin/csurf'
var csrf = csurf.default || (csurf as unknown as typeof csurf.default)
import Promise from 'bluebird'
import * as basicAuth from 'basic-auth'

import apiutil from '../../util/apiutil.js'
import logger from '../../util/logger.js'
import requtil from '../../util/requtil.js'
import jwtutil from '../../util/jwtutil.js'
// Fork (Zebrunner): the short token of the sign-in
import signin from '../../util/zebrunner-signin.js'
import pathutil from '../../util/pathutil.js'
import urlutil from '../../util/urlutil.js'
import lifecycle from '../../util/lifecycle.js'

import dbapi from '../../db/api.js'
import zebrunnerSession from '../../util/zebrunner-session.js'
import zebrunnerContact from '../../util/zebrunner-contact.js'

interface MockAuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  mock: {
    useBasicAuth?: boolean
    basicAuth: {
      username?: string
      password?: string
    }
    // Fork (Zebrunner): the credentials an admin of STF signs in with, see adminSignIn below
    adminBasicAuth?: {
      username?: string
      password?: string
    }
  }
}

// Fork (Zebrunner): a comparison of a credential in constant time, the digests make the lengths equal
function same(given: string, expected: string | undefined) {
  if (!expected) {
    return false
  }
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(given).digest()
  , crypto.createHash('sha256').update(expected).digest()
  )
}

function credentials(req: express.Request) {
  var header = req.headers.authorization
  return header ? basicAuth.parse(header) : null
}

export default function(options: MockAuthOptions) {
  var log = logger.createLogger('auth-mock')
  var app = express()

  // Fork (Zebrunner): with the admin credentials set, an admin of STF signs in with them only. The mock sign-in takes
  // any name and email behind the credentials of the users, so without them whoever has those credentials and knows
  // the name and the email of an admin (GET /auth/contact tells a signed-in user the email of the root group's
  // owner) signs in as the admin
  var adminAuth = options.mock.adminBasicAuth || {}
  var adminSignIn = Boolean(adminAuth.username && adminAuth.password)
  function isAdminCredentials(user: ReturnType<typeof credentials>) {
    return Boolean(user && user.name && user.pass &&
      same(user.name, adminAuth.username) && same(user.pass, adminAuth.password))
  }
  if (options.mock.useBasicAuth && !adminSignIn) {
    log.warn('The admin credentials of the mock sign-in are not set ' +
      '(--admin-basic-auth-username and --admin-basic-auth-password): whoever has the ' +
      'credentials of the users may sign in as an admin of STF')
  }
  var server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  // BasicAuth Middleware
  var basicAuthMiddleware = function(
    req: express.Request
  , res: express.Response
  , next: express.NextFunction
  ) {
    function unauthorized(res: express.Response) {
      res.set('WWW-Authenticate', 'Basic realm=Authorization Required')
      return res.sendStatus(401)
    }

    var user = credentials(req)

    if (!user || !user.name || !user.pass) {
      return unauthorized(res)
    }

    // Fork (Zebrunner): in constant time, the admin credentials too
    if ((same(user.name, options.mock.basicAuth.username) &&
        same(user.pass, options.mock.basicAuth.password)) || isAdminCredentials(user)) {
      return next()
    }
    else {
      return unauthorized(res)
    }
  }

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/mock/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  // Fork (Zebrunner): HttpOnly, SameSite=Lax and Secure with an https --app-url or over https,
  // lib/util/zebrunner-session.ts
  app.use(zebrunnerSession.sessionCookie(options.ssid, options.secret, options.appUrl))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use('/static/auth/mock', serveStatic(pathutil.resource('auth/mock')))

  // Fork (Zebrunner): Secure as the session cookie, lib/util/zebrunner-session.ts
  app.use(zebrunnerSession.xsrfCookie(options.appUrl))

  if (options.mock.useBasicAuth) {
    app.use(basicAuthMiddleware)
  }

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/mock/')
  })

  // Fork (Zebrunner): the admin for the signed-in users only, lib/util/zebrunner-contact.ts
  app.get('/auth/contact', zebrunnerContact.contact(log))

  app.get('/auth/mock/', function(req, res) {
    res.render('index')
  })

  app.post('/auth/api/v1/mock', requtil.validators.mockLoginValidator, function(
    req: express.Request
  , res: express.Response
  ) {
    var log = logger.createLogger('auth-mock')
    log.setLocalIdentifier(req.ip)
    switch (req.accepts(['json'])) {
      case 'json':
        requtil.validate(req)
          .then(function() {
            return dbapi.checkUserBeforeLogin(req.body)
          })
          .then(function(isValidCredential) {
            if (!isValidCredential) {
              return Promise.reject('InvalidCredentialsError')
            }
            return isValidCredential
          })
          // Fork (Zebrunner): an admin of STF with the admin credentials only, the same answer as a wrong name
          .then(function() {
            if (!adminSignIn || isAdminCredentials(credentials(req))) {
              return null
            }
            return dbapi.loadUser(req.body.email).then(function(user) {
              if (user && user.privilege === apiutil.ADMIN) {
                log.warn('Refused the admin "%s" to the credentials of the users', req.body.email)
                return Promise.reject('InvalidCredentialsError')
              }
              return null
            })
          })
          .then(function() {
            log.info('Authenticated "%s"', req.body.email)
            var token = jwtutil.encode({
              payload: {
                email: req.body.email
              , name: req.body.name
              }
            , secret: options.secret
            , header: {
                // Fork (Zebrunner)
                exp: signin.signInTokenExpiry()
              }
            })
            res.status(200)
              .json({
                success: true
              , redirect: urlutil.addParams(options.appUrl, {
                  jwt: token
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
          .catch(function(err) {
            if (err === 'InvalidCredentialsError') {
              log.warn('Authentication failure for "%s"', req.body.email)
              res.status(400)
                .json({
                  success: false
                , error: 'InvalidCredentialsError'
                })
            }
            else {
              log.error('Unexpected error', err.stack)
              res.status(500)
                .json({
                  success: false
                , error: 'ServerError'
                })
            }
          })
        break
      default:
        res.sendStatus(406)
        break
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
