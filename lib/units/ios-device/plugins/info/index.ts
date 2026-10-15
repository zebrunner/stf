import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import wireutil from '../../../../wire/util.js'
import wire from '../../../../wire/index.js'
import logger from '../../../../util/logger.js'
import type {IosDeviceOptions, IosInfoPlugin, Push} from '../../../../types/ios-device.js'
import pushSyrup from '../../support/push.js'

export default syrup.serial()
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, push: Push): IosInfoPlugin {
    var log = logger.createLogger('device:info')

    function manageDeviceInfo() {
      return new Promise<void>(function(resolve) {
          log.info('device.name: ' + options.deviceName)

          var solo = wireutil.makePrivateChannel()
          var osName = 'iOS'
          var deviceName = options.deviceName.toLowerCase()

          if (deviceName.includes('tv')) {
            osName = 'tvOS'
          }

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.InitializeIosDeviceState(
              options.serial
            , wireutil.toDeviceStatus('device')
            , new wire.ProviderIosMessage(
                solo
              , options.provider
              , options.screenWsUrlPattern || ''
              )
            , new wire.IosDevicePorts(
                options.screenPort
              , options.connectPort
              )
            , new wire.UpdateIosDevice(
                options.serial
              , options.deviceName
              , osName
              , 'amd64'
              )
            ))
          ])

          resolve()
        })
        .catch(function(err) {
          log.error(err, 'Failed to manage device info')
        })
    }

    return {
      manageDeviceInfo: manageDeviceInfo
    }
  })
