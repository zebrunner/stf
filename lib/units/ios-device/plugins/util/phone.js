var syrup = require('stf-syrup')

var logger = require('../../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../service'))
  .define(function(options, service) {
    var log = logger.createLogger('device:plugins:phone')

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
