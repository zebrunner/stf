import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {IosDeviceOptions, Push, Router} from '../../../types/ios-device.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import {execGoIos} from './util/goios.js'

// go-ios asks the device to restart and returns, the device goes away afterwards
const REBOOT_TIMEOUT = 30000

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, router: Router, push: Push) {
    var log = logger.createLogger('device:plugins:reboot')

    router.on(wire.RebootMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      execGoIos(options.serial, ['reboot'], REBOOT_TIMEOUT)
        .then(function() {
          log.important('Rebooting the device')
          push.send([
            channel
          , reply.okay()
          ])
        })
        .catch(function(err: Error) {
          log.error('Reboot failed: %s', err.message)
          push.send([
            channel
          , reply.fail(err.message)
          ])
        })
    })
  })
