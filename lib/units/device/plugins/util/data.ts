import syrup from '@devicefarmer/stf-syrup'
import deviceData from '@devicefarmer/stf-device-db'

import logger from '../../../../util/logger.js'
import type {
  DeviceData
, DeviceIdentity
, DevicePluginOptions
} from '../../../../types/device-plugins.js'
import identitySyrup from './identity.js'

export default syrup.serial()
  .dependency(identitySyrup)
  .define(function(options: DevicePluginOptions, identity: DeviceIdentity): DeviceData | null {
    var log = logger.createLogger('device:plugins:data')

    function find() {
      var data = deviceData.find({
        model: identity.model
      , name: identity.product
      , manufacturer: identity.manufacturer
      , platform: identity.platform
      })
      if (!data) {
        log.warn('Unable to find device data', identity)
      }
      return data
    }

    return find()
  })
