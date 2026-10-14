import syrup from '@devicefarmer/stf-syrup'

import lifecycle from '../../../util/lifecycle.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {IosDeviceOptions, Push} from '../../../types/ios-device.js'
import pushSyrup from '../support/push.js'

export default syrup.serial()
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, push: Push) {
    function beat() {
      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceHeartbeatMessage(
          options.serial
        ))
      ])
    }

    var timer = setInterval(beat, options.heartbeatInterval)

    lifecycle.observe(function() {
      clearInterval(timer)
    })
  })
