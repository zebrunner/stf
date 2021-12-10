const request = require('request-promise')
const Promise = require('bluebird')
const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')

const WDA_UNAVAILABLE_MSG = 'RequestError'
const LOG_API_REQUEST_MSG = 'Has been sent api request to WDA with data :'

module.exports = syrup.serial()
  .dependency(require('../devicenotifier'))
  .dependency(require('../../support/push'))
  .define((options, notifier, push) => {
    const log = logger.createLogger('wdaClient')
    log.info("WdaClient.js initializing...")

    const WdaClient = {
      baseUrl: iosutil.getUri(options.wdaHost, options.wdaPort),

      sessionId: null,
      deviceSize: null,
      isInitialized: false,

      connect: function () {
        return new Promise((resolve, reject) => {
          request.get(`${this.baseUrl}/status`)
          .then(response => {
            this.sessionId = JSON.parse(response).sessionId
            log.info('sessionId: ' + this.sessionId)
            return resolve()
          })
          .catch(err => {
            log.error('"connect" No valid response from web driver!', err)
            return reject(err)
          })
        })
      },

      startSession: function() {
        log.info("starting wda session...")
        let params = {
          capabilities: {}
        }

        this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session`,
          body: params,
          json: true
        })
        .then(response => {
          log.info("startSession response: " + response)
          return this.connect()
        })
        .catch(err => {
          log.error('"startSession" No valid response from web driver!', err)
          return reject(err)
        })
      },

      stopSession: function() {
        log.info("stopping wda session...")
        let currentSessionId = this.sessionId
        this.sessionId = null
        return this.handleRequest({
          method: 'DELETE',
          uri: `${this.baseUrl}/session/${currentSessionId}` 
        })
      },
      homeBtn: function() {
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/wda/homescreen`
        })
      },
      size: function() {
        log.info(`window size: ${this.baseUrl}/session/${this.sessionId}/window/size`)

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/session/${this.sessionId}/window/size`
          })
          .then(response => {
            try {
              this.deviceSize = JSON.parse(response).value
              return resolve(this.deviceSize)
            }
            catch (e) {
              return reject(new Error('Failed to parse json object'))
            }
          })
          .catch(err => {
            return reject(err)
          })
        })
      },
      screenshot: function() {
        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/screenshot`,
            json: true
          })
          .then(response => {
            try {
              resolve(response)
            } catch(e) {
              reject(e)
            }
          })
          .catch(err => reject(err))
        })
      },
      handleRequest: function(requestOpt) {
        return new Promise((resolve, reject) => {
          request(requestOpt)
          .then(response => {
            log.verbose(LOG_API_REQUEST_MSG, JSON.stringify(requestOpt))
            return resolve(response)
          })
          .catch(err => {
            // in case if session is expired
            if (err.statusCode === 404) {
              const oldSessionId = this.sessionId

              this.connect()
              .then(() => {
                const newUri = requestOpt.uri.replace(oldSessionId, this.sessionId)
                log.verbose(LOG_API_REQUEST_MSG, JSON.stringify(requestOpt))

                this.handleRequest(Object.assign({}, requestOpt, {
                  uri: newUri
                }))
                .then(response => resolve(response))
              })
              .catch(err => {
                notifier.setDeviceTemporaryUnavialable(err)
                return reject(err)
              })
            }
            else if(err.name === WDA_UNAVAILABLE_MSG) {
              notifier.setDeviceTemporaryUnavialable(err)
              return reject(err)
            }
            else {
              log.error('Failed to send request with error', err)
            }
          })
        })
      },
      setInitialized: function() {
        this.isInitialized = true
      },
      initializeDeviceData: function() {
        return new Promise((resolve, reject) => {
          try {
            this.size()
            .then(response => {
              const {height, width} = response

              push.send([
                wireutil.global,
                wireutil.envelope(new wire.SizeIsoDevice(
                  options.serial,
                  height,
                  width
                ))
              ])

              resolve()
            })
            .catch(err => {
              reject(err)
            })
          }
          catch(err) {
            log.error(err)
          }
        })
      }
  }

  /* eslint-disable */
  return new Proxy(WdaClient, {
    get(target, prop) {
      log.info(WdaClient.sessionId)
      // (touchUp, doubleClick, swipe) - those functions require initialization before running
      if (['touchUp', 'doubleClick', 'swipe'].includes(prop) && !target.isInitialized) {
          return (...args) => {
            target.initializeDeviceData()
            .then(response => {
              target.setInitialized()
              let value = target[prop];
              return (typeof value === 'function') ? value.call(target, args[0]) : value;
            })
            .catch(err => log.error(err))
          }

      } else {
        let value = target[prop];
        return (typeof value === 'function') ? value.bind(target) : value;
      }
    }
  })
})
