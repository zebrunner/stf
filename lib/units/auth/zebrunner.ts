/**
* Fork (Zebrunner): authenticates users against the Zebrunner reporting service.
**/

import http from 'http'

import express from 'express'
import cookieSession from 'cookie-session'
import bodyParser from 'body-parser'
import serveStatic from 'serve-static'
// csurf exports the middleware factory directly up to 1.15.0 and as an ESM
// default from 1.16.1 on. Accept both, the declared range allows both.
import * as csurf from '@dr.pogodin/csurf'
var csrf = csurf.default || (csurf as unknown as typeof csurf.default)
import Promise from 'bluebird'
import axios from 'axios'

import logger from '../../util/logger.js'
import jwtutil from '../../util/jwtutil.js'
import pathutil from '../../util/pathutil.js'
import urlutil from '../../util/urlutil.js'
import lifecycle from '../../util/lifecycle.js'
import ratelimit from '../../util/ratelimit.js'

interface ZebrunnerAuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  zebrunner: {
    loginURL: string
    userinfoURL: string
  }
}

interface ZebrunnerAuthData {
  userId: string | number
  authToken: string
}

interface ZebrunnerUserData {
  username: string
  email?: string | null
}

interface ZebrunnerLocals {
  authData: ZebrunnerAuthData
  userData: ZebrunnerUserData
}

// The answers of the IAM login to credentials it does not accept
var REFUSED = [400, 401, 403, 404]

export default function(options: ZebrunnerAuthOptions) {
  var log = logger.createLogger('auth-zebrunner')
  var app = express()
  var server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  // Exchanges the submitted credentials for a Zebrunner token and loads the user behind it
  var authMiddleware = function(
    req: express.Request
  , res: express.Response<unknown, ZebrunnerLocals>
  , next: express.NextFunction
  ) {
    var signedIn = false
    axios.post<ZebrunnerAuthData>(options.zebrunner.loginURL, req.body)
      .then(function(response) {
        signedIn = true
        res.locals.authData = response.data
        return axios.get<ZebrunnerUserData>(
          `${options.zebrunner.userinfoURL}/${res.locals.authData.userId}`
        , {
            headers: {
              Authorization: `Bearer ${res.locals.authData.authToken}`
            }
          }
        )
      })
      .then(function(userDataResponse) {
        res.locals.userData = userDataResponse.data
        return next()
      })
      .catch(function(error: unknown) {
        var status = axios.isAxiosError(error) && error.response ? error.response.status : 0
        // IAM refuses unknown or wrong credentials and deactivated users: they count for ratelimit()
        if (!signedIn && REFUSED.includes(status)) {
          log.warn('Authentication failure (IAM answered %d)', status)
          return res.status(400)
            .json({
              success: false
            , error: 'InvalidCredentialsError'
            })
        }
        // Never the error itself: the config of an axios error holds the submitted password
        // and the token of the user
        log.error(
          'Zebrunner IAM failed to %s: %s'
        , signedIn ? 'load the user' : 'sign in'
        , error instanceof Error ? error.message : String(error)
        )
        return res.status(502)
          .json({
            success: false
          , error: 'ServerError'
          })
      })
  }

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/zebrunner/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use('/static/auth/zebrunner', serveStatic(pathutil.resource('auth/zebrunner')))

  app.use(function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/zebrunner/')
  })

  app.get('/auth/zebrunner/', function(req, res) {
    res.render('index')
  })

  app.post('/auth/api/v1/zebrunner', ratelimit(), authMiddleware, function(
    req: express.Request
  , res: express.Response<unknown, ZebrunnerLocals>
  ) {
    var userData = res.locals.userData
    // Zebrunner users may have no email; STF needs one to identify the user
    var email = userData.email || `${userData.username}@fakedomain.com`
    var token = jwtutil.encode({
      payload: {
        email: email
      , name: userData.username
      }
    , secret: options.secret
    , header: {
        // The token only carries the user to the app, which starts a session with it right away
        // (lib/util/authsession.ts); in the address it would otherwise sign in for a whole day
        exp: Date.now() + 2 * 60 * 1000
      }
    })

    res.status(200)
      .json({
        success: true
      , redirect: urlutil.addParams(`${options.appUrl}stf`, {
          jwt: token
        })
      })
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
