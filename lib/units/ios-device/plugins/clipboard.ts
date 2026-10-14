import syrup from '@devicefarmer/stf-syrup'

import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {IosDeviceOptions, Push, Router, WdaClientPlugin} from '../../../types/ios-device.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import wdaClientSyrup from './wda/WdaClient.js'

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(wdaClientSyrup)
  .define(function(
    options: IosDeviceOptions
  , router: Router
  , push: Push
  , wdaClient: WdaClientPlugin
  ) {
    router.on(wire.CopyMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      wdaClient.getClipBoard()
        .then(function(clipboard) {
          push.send([
            channel
          , reply.okay(clipboard)
          ])
        })
        .catch(function() {
          push.send([
            channel
          , reply.fail('')
          ])
        })
    })
  })
