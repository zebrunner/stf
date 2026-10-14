import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wireutil from '../../../wire/util.js'
import srv from '../../../util/srv.js'
import lifecycle from '../../../util/lifecycle.js'
import '../../../util/lifecycle.js'
import zmqutil from '../../../util/zmqutil.js'
import type {IosDeviceOptions, Sub} from '../../../types/ios-device.js'

export default syrup.serial()
  .define(function(options: IosDeviceOptions): Promise<Sub> {
    var log = logger.createLogger('device:support:sub')
    var sub = zmqutil.socket('sub')

    return Promise.map(options.endpoints.sub, function(endpoint) {
        return srv.resolve(endpoint).then(function(records) {
          return srv.attempt(records, function(record) {
            log.info('Receiving input from "%s"', record.url)
            sub.connect(record.url)
            return Promise.resolve(true)
          })
        })
      })
      .then(function() {
        [wireutil.global].forEach(function(channel) {
          log.info('Subscribing to permanent channel "%s"', channel)
          sub.subscribe(channel)
        })
      })
      .catch(function(err) {
        log.fatal('Unable to connect to sub endpoint', err)
        lifecycle.fatal(err)
      })
      .return(sub)
  })
