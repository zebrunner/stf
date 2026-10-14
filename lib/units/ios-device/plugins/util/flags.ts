import syrup from '@devicefarmer/stf-syrup'

import type {DeviceData, DeviceFlags, Flags} from '../../../../types/ios-device.js'
import dataSyrup from './data.js'

export default syrup.serial()
  .dependency(dataSyrup)
  .define(function(_options: unknown, data: DeviceData | null): Flags {
    return {
      has: function(flag: keyof DeviceFlags) {
        return data && data.flags && !!data.flags[flag]
      }
    , get: function<K extends keyof DeviceFlags, D>(flag: K, defaultValue: D) {
        return data && data.flags && typeof data.flags[flag] !== 'undefined' ?
          data.flags[flag] :
          defaultValue
      }
    }
  })
