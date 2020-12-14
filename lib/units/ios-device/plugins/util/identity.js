const syrup = require('@devicefarmer/stf-syrup')
const devutil = require('../../../../util/devutil')
const logger = require('../../../../util/logger')

module.exports = syrup.serial()
  .dependency(require('../../support/properties'))
  .dependency(require('./display'))
  .dependency(require('./phone'))
  .define(function(options, properties, display, phone) {
    const log = logger.createLogger('device:plugins:identity')

    function solve() {
      log.info('Solving identity')
      var identity = devutil.makeIdentity(options.serial, properties)
      identity.display = display.properties
      identity.phone = phone
      return identity
    }

    return solve()
  })
