const http = require('http')
const express = require('express')
const validator = require('express-validator')
const cookieSession = require('cookie-session')
const bodyParser = require('body-parser')
const serveStatic = require('serve-static')
const csrf = require('csurf')
const Promise = require('bluebird')
const axios = require('axios')

const logger = require('../../util/logger')
const pathutil = require('../../util/pathutil')
const lifecycle = require('../../util/lifecycle')
const authsession = require('../../util/authsession')
const ratelimit = require('../../util/ratelimit')

module.exports = function(options) {
  const log = logger.createLogger('auth-zebrunner')
  const app = express()
  app.disable('x-powered-by')
  const server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  // Middleware to make calls to Zebrunner API
  const authMiddleware = (req, res, next) => {
    axios.post(options.zebrunner.loginURL, req.body)
      .then((response) => {
        res.locals.authData = response.data
        const config = {
          headers: {
            Authorization: `Bearer ${res.locals.authData.authToken}`
          }
        }

        return axios.get(`${options.zebrunner.userinfoURL}/${res.locals.authData.userId}`, config)
          .then((userDataResponse) => {
            res.locals.userData = userDataResponse.data
            next()
          })
      })
      .catch((error) => {
        if (error.response && error.response.status === 404) {
          res.status(400)
            .json({
              success: false
              , error: 'InvalidCredentialsError'
            })
        }
        else {
          log.error('authMiddleware, response error', error)
          next(error)
        }
      })
  }

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/zebrunner/views'))
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
  app.use('/static/bower_components', serveStatic(pathutil.resource('bower_components')))
  app.use('/static/auth/zebrunner', serveStatic(pathutil.resource('auth/zebrunner')))

  app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer')
    // Refuse framing so the login page cannot be clickjacked (SLV-008).
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.get('/', function(req, res) {
    res.redirect('/auth/zebrunner/')
  })

  app.get('/auth/zebrunner/', function(req, res) {
    res.render('index')
  })

  // Throttle and lock out repeated failed logins before the Zebrunner API call (SLV-005).
  app.post(
    '/auth/api/v1/zebrunner',
    ratelimit(),
    authMiddleware,
    function(req, res, next) {
      const {userData} = res.locals
      const email = userData.email || `${userData.username}@fakedomain.com` // probably can cause problems if user adds email in the future
      // Establish the session in the shared `ssid` cookie and hand back a clean
      // URL so the token never travels in the redirect (SLV-003).
      authsession.establish(req, {
        email
        , name: userData.username
      })
        .then(function() {
          res.status(200)
            .json({
              success: true
              , redirect: `${options.appUrl}stf`
            })
        })
        .catch(next)
    }
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
