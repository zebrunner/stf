import syrup from '@devicefarmer/stf-syrup'

import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import logger from '../../../util/logger.js'
import lifecycle from '../../../util/lifecycle.js'
import timeutil from '../../../util/timeutil.js'
import type {
  IosDeviceOptions
, IosGroupPlugin
, IosNotifierPlugin
, Push
} from '../../../types/ios-device.js'
import pushSyrup from '../support/push.js'
import groupSyrup from './group.js'

function hasStatusCode(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'statusCode' in err
}

export default syrup.serial()
  .dependency(pushSyrup)
  .dependency(groupSyrup)
  .define(function(
    options: IosDeviceOptions
  , push: Push
  , group: IosGroupPlugin
  ): IosNotifierPlugin {
    var log = logger.createLogger('device:plugins:notifier')
    var notifier: IosNotifierPlugin = Object.create(null)

    notifier.setDeviceTemporaryUnavailable = function(_err: unknown) {
      group.get()
        .then(function(currentGroup) {
          push.send([
            currentGroup.group
          , wireutil.envelope(new wire.TemporarilyUnavailableMessage(
              options.serial
            ))
          ])
        })
        .catch(function(err) {
          log.error('Cannot set device temporary unavailable', err)
        })
    }

    notifier.setDeviceAbsent = function(err: unknown) {
      if (hasStatusCode(err)) {
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DeviceStatusMessage(
            options.serial
          , 1
          , timeutil.now('nano')
          ))
        ])
      }
      else {
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DeviceAbsentMessage(
            options.serial
          ))
        ])
      }

      lifecycle.graceful(err)
    }

    return notifier
  })
