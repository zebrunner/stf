const logger = require('../../../util/logger')
const Promise = require('bluebird')

const wda = require('wda-driver')
const request = require('request')
const requestP = require('request-promise')
const syrup = require('stf-syrup')
const wire = require('../../../wire')
const wirerouter = require('../../../wire/router')
const wireutil = require('../../../wire/util')

module.exports = syrup.serial()
  .dependency(require('./solo'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../support/sub'))
  .define((options, solo, router, push, sub) => {
    const log = logger.createLogger('wda:client')
    try {
      const WdaClient = {}
      const streamPort = 9100

      WdaClient.connect = (port) => {
          const wdaPort = port || 8100
          const client = new wda.Client(`http://192.168.0.116:${wdaPort}`)
          let wdaSession = ''
          requestP.get(`http://192.168.0.116:${wdaPort}`)
            .then(response => {
              wdaSession = JSON.parse(response).sessionId
              log.info(wdaSession)
            })
            .catch(err => {
              log.error(err)
            })

          client.session('com.apple.Health')
            .then(result => {
              wdaSession = result
            })
            .catch(err => {
              log.error('failed to get session of wda with exception ', err)
            })
          sub.on('message', wirerouter()
            .on(wire.KeyPressMessage, (channel, message) => {
              log.info('wda plugin KeyPressMessage', message)
              client.home()
            })
            .on(wire.TouchDownIosMessage, (channel, message) => {
              log.info('wda plugin TouchDownIosMessage', message)
              client.tap(message.x, message.y)
              wdaSession.tap(message.x, message.y)
            })
            .handler())
      }

      WdaClient.startStream = () => {
        log.info(`start streaming on port ${streamPort}`)
        return request.get('http://localhost:9100')
      }

      return WdaClient
    } catch(e) {
      log.error('~~~~~~failed to execute wda plugin with exception :', e)
    }

  })
