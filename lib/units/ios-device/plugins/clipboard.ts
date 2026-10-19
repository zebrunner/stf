import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {IosDeviceOptions, Push, Router, WdaClientPlugin} from '../../../types/ios-device.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import wdaClientSyrup from './wda/WdaClient.js'
import PasteboardAutomation from './wda/pasteboard.js'
import {wdaErrorMessage} from './wda/automation.js'

// The clipboard card of the dashboard: reads the pasteboard of the device, and pastes like Android
// (the text goes to the pasteboard and is typed into the focused field), see wda/pasteboard.ts
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
    var log = logger.createLogger('device:plugins:clipboard')
    var pasteboard = new PasteboardAutomation({
      baseUrl: wdaClient.baseUrl
    , sessionId: function() {
        return wdaClient.sessionId
      }
    })

    router.on(wire.CopyMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      pasteboard.get()
        .then(function(text) {
          push.send([channel, reply.okay(text)])
        })
        .catch(function(err) {
          log.error('Reading the pasteboard failed', err.stack)
          push.send([channel, reply.fail(wdaErrorMessage(err))])
        })
    })

    router.on(wire.PasteMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)
      pasteboard.paste(message.text)
        .then(function(typed) {
          if (!typed) {
            log.info('No focused field, the text is only in the pasteboard')
          }
          push.send([channel, reply.okay()])
        })
        .catch(function(err) {
          log.error('Pasting failed', err.stack)
          push.send([channel, reply.fail(wdaErrorMessage(err))])
        })
    })
  })
