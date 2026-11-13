import syrup from '@devicefarmer/stf-syrup'
import type {
  DeviceFlags
, DeviceIdentity
, DevicePluginOptions
, Flags
} from '../../../../types/device-plugins.js'
import identitySyrup from './identity.js'

// The flags of stf-device-db 1, which version 2 no longer has, keyed like its models: the model
// without the brand, spaces as underscores
var flagsByModel: Record<string, DeviceFlags> = {
  'F-06F': {forceMaxPressure: 10000, forceTouchMode: 'pressure'}
, 'F-08E': {forceMaxPressure: 10000, forceTouchMode: 'pressure'}
, 'F-09E': {forceMaxPressure: 10000, forceTouchMode: 'pressure'}
, 'F-12D': {forceMaxPressure: 10000, forceTouchMode: 'pressure'}
, 'SC-03D': {forceMinScreenScale: 1}
, '_B6000-F': {forceTouchOrigin: 'bottom left'}
}

export function modelFlags(model: string | null | undefined): DeviceFlags | null {
  var key = (model || '').replace(/ /g, '_')
  return Object.prototype.hasOwnProperty.call(flagsByModel, key) ? flagsByModel[key]! : null
}

export default syrup.serial()
  .dependency(identitySyrup)
  .define(function(options: DevicePluginOptions, identity: DeviceIdentity): Flags {
    var flags = modelFlags(identity.model)
    return {
      has: function(flag) {
        return flags && !!flags[flag]
      }
    , get: function(flag, defaultValue) {
        return flags && typeof flags[flag] !== 'undefined' ?
          flags[flag] :
          defaultValue
      }
    }
  })
