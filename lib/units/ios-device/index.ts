import {createRequire} from 'module'

import syrup from '@devicefarmer/stf-syrup'

import logger from '../../util/logger.js'
import lifecycle from '../../util/lifecycle.js'
import type {IosDeviceOptions, IosSoloPlugin} from '../../types/ios-device.js'

var require = createRequire(import.meta.url)

interface WdaPlugin {
  connect(): void
}

export default function(options: IosDeviceOptions) {
  logger.setGlobalIdentifier(options.serial)

  return syrup.serial()
    .dependency(require('./plugins/logger.js').default)
    .define(function(options: IosDeviceOptions) {
      var log = logger.createLogger('ios-device')
      log.info('Preparing device options: ', options)

      return syrup.serial()
        .dependency(require('./plugins/heartbeat.js').default)
        .dependency(require('./plugins/solo.js').default)
        .dependency(require('./plugins/info/index.js').default)
        .dependency(require('./plugins/wda.js').default)
        .dependency(require('./support/push.js').default)
        .dependency(require('./support/sub.js').default)
        .dependency(require('./plugins/group.js').default)
        .dependency(require('./support/storage.js').default)
        .dependency(require('./plugins/devicelog.js').default)
        .dependency(require('./plugins/screen/stream.js').default)
        .dependency(require('./plugins/install.js').default)
        .dependency(require('./plugins/reboot.js').default)
        .dependency(require('./plugins/clipboard.js').default)
        .define(function(
          options: IosDeviceOptions
        , heartbeat: unknown
        , solo: IosSoloPlugin
        , info: unknown
        , wda: WdaPlugin
        , ..._rest: unknown[]
        ) {
          if (process.send) {
            process.send('ready')
          }

          try {
            wda.connect()
            solo.poke()
          }
          catch (err) {
            log.error('err :', err)
          }
        })
        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      logger.createLogger('ios-device').fatal('Setup had an error', err.stack)
      lifecycle.fatal(err)
    })
}
