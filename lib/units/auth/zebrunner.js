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
const jwtutil = require('../../util/jwtutil')
const pathutil = require('../../util/pathutil')
const urlutil = require('../../util/urlutil')
const lifecycle = require('../../util/lifecycle')

module.exports = function(options) {
  const log = logger.createLogger('auth-zebrunner')
  const app = express()
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
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.get('/', function(req, res) {
    res.redirect('/auth/zebrunner/')
  })

  app.get('/auth/zebrunner/', function(req, res) {
    res.render('index')
  })

  app.post(
    '/auth/api/v1/zebrunner',
    authMiddleware,
    function(req, res) {
      const {userData} = res.locals
      const email = userData.email || `${userData.username}@fakedomain.com` // probably can cause problems if user adds email in the future
      const token = jwtutil.encode({
        payload: {
          email
          , name: userData.username
        }
        , secret: options.secret
        , header: {
          exp: Date.now() + 24 * 3600
        }
      })

      res.status(200)
        .json({
          success: true
          , redirect: urlutil.addParams(`${options.appUrl}stf`, {
            jwt: token
          })
        })
    }
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
