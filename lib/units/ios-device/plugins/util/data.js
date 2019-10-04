const syrup = require('stf-syrup')
const deviceData = require('stf-device-db')
const logger = require('../../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('./identity'))
  .define(function(options, identity) {
    const log = logger.createLogger('device:plugins:data')

    function find() {
      var data = deviceData.find(identity)
      if (!data) {
        log.warn('Unable to find device data', identity)
      }
      return data
    }

    return find()
  })
