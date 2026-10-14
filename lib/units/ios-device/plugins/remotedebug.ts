import syrup from '@devicefarmer/stf-syrup'

import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import logger from '../../../util/logger.js'
import type {IosDeviceOptions, IosGroupPlugin, Push} from '../../../types/ios-device.js'
import groupSyrup from './group.js'
import pushSyrup from '../support/push.js'
import type {OwnerMessage} from '../../../types/wire.js'

export default syrup.serial()
  .dependency(groupSyrup)
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, group: IosGroupPlugin, push: Push) {
    var log = logger.createLogger('remote debug')

    function updateRemoteConnectUrl(currentGroup: OwnerMessage) {
      push.send([
        currentGroup.group
      , wireutil.envelope(new wire.UpdateRemoteConnectUrl(
          options.serial
        ))
      ])
    }

    group.on('join', function(currentGroup) {
      updateRemoteConnectUrl(currentGroup)
    })

    group.on('leave', function() {
      log.info('Remote debug group left')
    })
  })
