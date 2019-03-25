const syrup = require('stf-syrup')
const logger = require('../../util/logger')
const wireutil = require('../../wire/util')
const wire = require('../../wire')
const promiseRetry = require('promise-retry')
const {spawn} = require('child_process')
const lifecycle = require('../../util/lifecycle')
let proxyWdaServerPort, proxyConnectPort

function killProxy() {
  proxyWdaServerPort.kill('SIGINT')
  proxyConnectPort.kill('SIGINT')
}

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
        .dependency(require('./plugins/connect'))
        .dependency(require('./plugins/reboot'))
        .dependency(require('./plugins/clipboard'))
        .define(function(options, heatbeat, solo, push, sub,
         storage, devicelog, stream, wda, connect) {
          if (process.send) {
            process.send('ready')
          }
          // if the parameter iprory is passed, used iproxy connection
          if(options.iproxy) {
              proxyConnectPort = spawn('iproxy', [options.connectPort, options.connectPort])
              proxyWdaServerPort = spawn('iproxy', [options.wdaServerPort, options.wdaServerPort])
          }
          //  esle used normal connection

          promiseRetry({
            retries: 15,
            maxTimeout: 15 * 1000,
            factor: 1
          }, function(retry, number) {
            log.important(`Trying to connet to WDA , TRY : ${number}`)
            return wda.connect(options.wdaServerPort)
              .catch(retry)
          })
            .then(() => {
              solo.poke()
            }, () => {
              push.send([
                wireutil.global,
                wireutil.envelope(new wire.DeviceAbsentMessage(
                  options.serial
                ))
              ])
              if(options.iproxy) {
              killProxy()
              }
              lifecycle.fatal()
            })
        })
        .consume(options)
    })
    .consume(options)
    .catch(() => {
      if(options.iproxy) {
        killProxy()
        }
      lifecycle.fatal()
    })
}
