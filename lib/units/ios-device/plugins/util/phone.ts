import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../../util/logger.js'
import type {PhoneProperties} from '../../../../types/ios-device.js'

export default syrup.serial()
  .define(function(): PhoneProperties {
    logger.createLogger('device:plugins:phone')
    return {}
  })
