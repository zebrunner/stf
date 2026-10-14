import syrup from '@devicefarmer/stf-syrup'
import deviceData from '@devicefarmer/stf-device-db'

import logger from '../../../../util/logger.js'
import type {DeviceData, IosIdentity} from '../../../../types/ios-device.js'
import identitySyrup from './identity.js'

export default syrup.serial()
  .dependency(identitySyrup)
  .define(function(_options: unknown, identity: IosIdentity): DeviceData | null {
    var log = logger.createLogger('device:plugins:data')

    var data = deviceData.find(identity as unknown as Parameters<typeof deviceData.find>[0])
    if (!data) {
      log.warn('Unable to find device data', identity)
    }
    return data
  })
