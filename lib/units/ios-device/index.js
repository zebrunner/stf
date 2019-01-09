const syrup = require('stf-syrup')
const logger = require('../../util/logger')
const request = require('requestretry')
const promiseRetry = require('promise-retry')
const lifecycle = require('../../util/lifecycle')
const Promise = require('bluebird')
// var request = require('request')
  module.exports = function(options) {
  // Show serial number in logs
  logger.setGlobalIdentifier(options.serial)

    return syrup.serial()
    .dependency(require('./plugins/logger'))
    .define(function(options) {
      var log = logger.createLogger('device')
      log.info('Preparing device')
      return syrup.serial()
        .dependency(require('./plugins/heartbeat'))
        .dependency(require('./plugins/solo'))
        .dependency(require('./support/push'))
        .dependency(require('./support/sub'))
        .dependency(require('./plugins/group'))
        .dependency(require('./support/storage'))
        .dependency(require('./plugins/devicelog'))
        .dependency(require('./plugins/wda'))
        .dependency(require('./plugins/screen/stream'))
        .define(function(options, heatbeat, solo, push, sub,
         storage, devicelog, stream, wda) {
          if (process.send) {
            // Only if we have a parent process
            process.send('ready')
          }


          promiseRetry(function(retry, number) {
            log.important(`Trying to connet to WDA , TRY : ${number}`)
            return wda.connect()
              .catch(retry)
          })
            .then(function(value) {
              solo.poke()
            }, function(err) {
              lifecycle.fatal()
            }, {
              retries: 120,
              maxTimeout: 15 * 1000
            })
        })
        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      lifecycle.fatal()
    })
}
