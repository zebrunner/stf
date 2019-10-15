const syrup = require('stf-syrup')
const logger = require('../../util/logger')
const wireutil = require('../../wire/util')
const wire = require('../../wire')
const promiseRetry = require('promise-retry')
const {spawn} = require('child_process')
const lifecycle = require('../../util/lifecycle')
let proxyWdaServerPort, proxyConnectPort

function killProxy() {
// TODO: [VD] we shouldn't kill wda at all even for proxy!
//  proxyWdaServerPort.kill('SIGINT')
  proxyConnectPort.kill('SIGINT')
}

  module.exports = function(options) {
  // Show serial number in logs
  logger.setGlobalIdentifier(options.serial)

    return syrup.serial()
    .dependency(require('./plugins/logger'))
    .define(function(options) {
      var log = logger.createLogger('device')
      log.info('Preparing device2. options: ', options)

      return syrup.serial()
        .dependency(require('./plugins/heartbeat'))
        .dependency(require('./plugins/solo'))
        .dependency(require('./plugins/info/'))
        .dependency(require('./plugins/wda'))
        .dependency(require('./support/push'))
        .dependency(require('./support/sub'))
        .dependency(require('./plugins/group'))
        .dependency(require('./support/storage'))
        .dependency(require('./plugins/devicelog'))
        .dependency(require('./plugins/screen/stream'))
        .dependency(require('./plugins/connect'))
        .dependency(require('./plugins/reboot'))
        .dependency(require('./plugins/clipboard'))
        .define(function(options, heartbeat, solo, info, wda) {
          if (process.send) {
            process.send('ready')
          }
          // if the parameter iprory is passed, used iproxy connection
          if(options.iproxy) {
              proxyConnectPort = spawn('iproxy', [options.connectPort, options.connectPort])
              proxyWdaServerPort = spawn('iproxy', [options.wdaPort, options.wdaPort])
          }
          //  esle used normal connection

          try {
            wda.connect()
            solo.poke()
            info.manageDeviceInfo()
          }
          catch(err) {
            console.error('err :', err)
          }
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
