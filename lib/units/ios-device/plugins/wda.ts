import util from 'util'
import url from 'url'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'
import request from '@cypress/request'

import logger from '../../../util/logger.js'
import storageauth from '../../../util/storageauth.js'
import wire from '../../../wire/index.js'
import wirerouter from '../../../wire/router.js'
import wireutil from '../../../wire/util.js'
import iosutil from './util/iosutil.js'
import type {
  IosDeviceOptions
, Push
, Sub
, WdaClientPlugin
, WdaValueResponse
} from '../../../types/ios-device.js'
import type {ScreenCaptureMessage, TypeMessageFields} from '../../../types/wire.js'
import pushSyrup from '../support/push.js'
import subSyrup from '../support/sub.js'
import wdaClientSyrup from './wda/WdaClient.js'
// Fork (Zebrunner)
import {replayPath} from './wda/gesture.js'
import NavigationAutomation, {
  isNavigationKey
, pressNavigationKey
, screenSize
} from './wda/navigation.js'

interface WdaPlugin {
  connect(): Promise<void>
}

interface StorageUploadResponse {
  resources?: {
    file?: string
  }
}

function getTypedKey(message: TypeMessageFields): string | null {
  return iosutil.asciiparser(message.text)
}

export default syrup.serial()
  .dependency(pushSyrup)
  .dependency(subSyrup)
  .dependency(wdaClientSyrup)
  .define(function(
    options: IosDeviceOptions
  , push: Push
  , sub: Sub
  , wdaClient: WdaClientPlugin
  ): WdaPlugin {
    var log = logger.createLogger('wda:client')
    var Wda: WdaPlugin = Object.create(null)
    // Fork (Zebrunner): Back and Recents, see wda/navigation.ts
    var navigation = new NavigationAutomation({
      baseUrl: wdaClient.baseUrl
    , sessionId: function() {
        return wdaClient.sessionId
      }
    , screenWidth: function() {
        return wdaClient.deviceSize ?
          screenSize(wdaClient.deviceSize, wdaClient.orientation).width :
          null
      }
    })

    Wda.connect = function() {
      sub.on('message', wirerouter()
        .on(wire.KeyPressMessage, function(_channel, message) {
          // Fork (Zebrunner)
          if (isNavigationKey(message.key)) {
            pressNavigationKey(wdaClient, navigation, message.key)
            return
          }
          if (wdaClient.orientation === 'LANDSCAPE' && message.key === 'home') {
            wdaClient.rotation({orientation: 'PORTRAIT'}).then(function() {
              iosutil.pressButton.call(wdaClient, message.key)
            })
              .catch(function(err) {
                log.error('Failed to rotate device to : ', 'PORTRAIT', err)
              })
          }
          iosutil.pressButton.call(wdaClient, message.key)
        })
        .on(wire.StoreOpenMessage, function() {
          iosutil.pressButton.call(wdaClient, 'store')
        })
        .on(wire.DashboardOpenMessage, function(_channel, message) {
          // A page of Settings is opened by radio.ts
          if (!message.page) {
            iosutil.pressButton.call(wdaClient, 'settings')
          }
        })
        .on(wire.PhysicalIdentifyMessage, function() {
          iosutil.pressButton.call(wdaClient, 'finder')
        })
        .on(wire.TouchDownIosMessage, function(_channel, message) {
          wdaClient.tap(message)
        })
        .on(wire.TouchMoveIosMessage, function(_channel, message) {
          wdaClient.swipe(message)
        })
        // Fork (Zebrunner): a whole gesture, see wda/gesture.ts
        .on(wire.TouchPathIosMessage, function(_channel, message) {
          replayPath(wdaClient, message.contacts)
        })
        .on(wire.TypeMessage, function(_channel, message) {
          log.verbose('wire.TypeMessage: ', message)
          wdaClient.typeKey({value: [getTypedKey(message)]})
        })
        .on(wire.KeyDownMessage, function(_channel, message) {
          log.verbose('wire.KeyDownMessage: ', message)
          wdaClient.typeKey({value: [iosutil.asciiparser(message.key)]})
          if (message.key === 'home') {
            wdaClient.homeBtn()
          }
        })
        .on(wire.BrowserOpenMessage, function(_channel, message) {
          wdaClient.openUrl(message)
        })
        .on(wire.RotateMessage, function(_channel, message) {
          if (wdaClient.isRotating) {
            return
          }

          var rotation = iosutil.degreesToOrientation(message.rotation)
          if (!rotation) {
            return
          }
          wdaClient.rotation({orientation: rotation})
            .then(function() {
              push.send([
                wireutil.global
              , wireutil.envelope(new wire.RotationEvent(
                  options.serial
                , message.rotation
                ))
              ])
            })
            .catch(function(err) {
              log.error('Failed to rotate device to : ', rotation, err)
            })
        })
        .on(wire.TouchUpMessage, function() {
          wdaClient.touchUp()
        })
        .on(wire.ScreenCaptureMessage, function(channel, _message: ScreenCaptureMessage) {
          var reply = wireutil.reply(options.serial)
          wdaClient.screenshot()
            .then(function(response: WdaValueResponse<string>) {
              var args = storageauth.sign({
                url: url.resolve(options.storageUrl, util.format('s/upload/%s', 'image'))
              })

              var imageBuffer = Buffer.from(response.value, 'base64')

              var req = request.post(args, function(err, _res, body) {
                try {
                  if (err) {
                    throw err
                  }
                  var result = JSON.parse(body) as StorageUploadResponse
                  push.send([
                    channel
                  , reply.okay('success', result.resources?.file)
                  ])
                }
                catch (err) {
                  log.error('Invalid JSON in response', (err as Error).stack, body)
                  push.send([channel, reply.fail('fail')])
                }
              })
              req.form().append('file', imageBuffer, {
                filename: util.format('%s.png', options.serial)
              , contentType: 'image/png'
              })
            })
            .catch(function(err) {
              log.error('Failed to get screenshot', err)
              push.send([channel, reply.fail('fail')])
            })
        })
        .handler())

      return Promise.resolve()
    }

    return Wda
  })
