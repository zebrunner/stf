const syrup = require('stf-syrup')
const logger = require('../../util/logger')
const lifecycle = require('../../util/lifecycle')

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
        .dependency(require('./plugins/reboot'))
        .dependency(require('./plugins/clipboard'))
        .dependency(require('./plugins/remotedebug/remotedebug'))
        .define(function(options, heartbeat, solo, info, wda) {
          if (process.send) {
            process.send('ready')
          }

          try {
            wda.connect()
            solo.poke()
          }
          catch(err) {
            log.error('err :', err)
          }
        })
        .consume(options)
    })
    .consume(options)
    .catch((err) => {
      lifecycle.fatal(err)
    })
}
