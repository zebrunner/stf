const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../service'))
  .define(function(options, service) {
    const log = logger.createLogger('device:plugins:phone')

    function fetch() {
      return service.getProperties([
        'imei'
      , 'imsi'
      , 'phoneNumber'
      , 'iccid'
      , 'network'
      ])
    }

    return fetch()
  })
