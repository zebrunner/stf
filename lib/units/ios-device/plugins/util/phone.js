const syrup = require('stf-syrup')
const logger = require('../../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../service'))
  .define(function(options, service) {
    const log = logger.createLogger('device:plugins:phone')

    function fetch() {
      log.info('Fetching phone info')
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
