const syrup = require('@devicefarmer/stf-syrup')
const _ = require('lodash')

module.exports = syrup.serial()
  .define(function(options) {
    var plugin = Object.create(null)

    plugin.devicePort = 9002
    plugin.publicPort = options.screenPort
    plugin.publicUrl = _.template(options.screenWsUrlPattern)({
      publicIp: options.publicIp
      , publicPort: plugin.publicPort
      , serial: options.serial
    })

    return plugin
  })
