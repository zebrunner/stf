import syrup from '@devicefarmer/stf-syrup'

import devutil from '../../../../util/devutil.js'
import logger from '../../../../util/logger.js'
import type {Properties} from '@devicefarmer/adbkit'
import type {
  DeviceDisplay
, DeviceIdentity
, DevicePluginOptions
, PhoneProperties
} from '../../../../types/device-plugins.js'
import propertiesSyrup from '../../support/properties.js'
import displaySyrup from './display.js'
import phoneSyrup from './phone.js'

type NamedDevicePluginOptions = DevicePluginOptions & {deviceName?: string}
type DeviceIdentityWithModule = DeviceIdentity & {module?: string}

export default syrup.serial()
  .dependency(propertiesSyrup)
  .dependency(displaySyrup)
  .dependency(phoneSyrup)
  .define(function(
    options: NamedDevicePluginOptions
  , properties: Properties
  , display: DeviceDisplay
  , phone: PhoneProperties
  ) {
    var log = logger.createLogger('device:plugins:identity')

    function solve() {
      log.info('Solving identity')
      var identity = devutil.makeIdentity(options.serial, properties) as DeviceIdentityWithModule
      identity.display = display.properties
      identity.phone = phone
      if (options.deviceName) {
        identity.module = options.deviceName
      }
      return identity
    }

    return solve()
  })
