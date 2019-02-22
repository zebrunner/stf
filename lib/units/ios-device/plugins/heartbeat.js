const syrup = require('stf-syrup')
const lifecycle = require('../../../util/lifecycle')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')

module.exports = syrup.serial()
  .dependency(require('../support/push'))
  .define(function(options, push) {
    function beat() {
      push.send([
        wireutil.global
        , wireutil.envelope(new wire.DeviceHeartbeatMessage(
          options.serial
        ))
      ])
    }

    let timer = setInterval(beat, options.heartbeatInterval)

    lifecycle.observe(function() {
      clearInterval(timer)
    })
  })
