var syrup = require('stf-syrup')

var logger = require('../../util/logger')
var lifecycle = require('../../util/lifecycle')

module.exports = function(options) {
  // Show serial number in logs
  logger.setGlobalIdentifier(options.serial)

  var log = logger.createLogger('ios-device')

  log.info('ios-device options', options)
}
