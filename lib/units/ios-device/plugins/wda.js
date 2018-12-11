const logger = require('../../../util/logger')
const Promise = require('bluebird')

const wda = require('wda-driver')
const request = require('request')
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
        const client = new wda.Client(`http://localhost:${wdaPort}`)
        sub.on('message', wirerouter()
          .on(wire.KeyPressMessage, (channel, message) => {
            client.home()
          })
          .on(wire.TouchDownIosMessage, (channel, message) => {
            client.tap(message.x, message.y)
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
