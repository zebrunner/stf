import net from 'net'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import request from '../util/rp.js'
import logger from '../../../../util/logger.js'
import iosutil from '../util/iosutil.js'
import wireutil from '../../../../wire/util.js'
import wire from '../../../../wire/index.js'
import lifecycle from '../../../../util/lifecycle.js'
import timeutil from '../../../../util/timeutil.js'
import type {
  IosDeviceOptions
, IosNotifierPlugin
, IosOrientation
, Push
, RpOptions
, WdaBatteryInfo
, WdaClientPlugin
, WdaErrorBody
, WdaSessionResponse
, WdaValueResponse
} from '../../../../types/ios-device.js'
import type {
  BrowserOpenMessageFields
, TouchDownIosMessageFields
, TouchMoveIosMessageFields
} from '../../../../types/wire.js'
import notifierSyrup from '../devicenotifier.js'
import activeOrNewSession from './session.js'
import pushSyrup from '../../support/push.js'
// Fork (Zebrunner)
import {startFastInput, stopFastInput} from './fast-input.js'
import devicestateSyrup, {type IosDeviceStatePlugin} from '../devicestate.js'

const LOG_REQUEST_MSG = 'Request has been sent to WDA with data: '
var NO_RESULT: undefined

function getErrorMessage(err: unknown): string {
  var body = err as {error?: WdaErrorBody}
  return body.error?.value?.message || ''
}

export default syrup.serial()
  .dependency(notifierSyrup)
  .dependency(pushSyrup)
  .dependency(devicestateSyrup)
  .define(function(
    options: IosDeviceOptions
  , notifier: IosNotifierPlugin
  , push: Push
  , devicestate: IosDeviceStatePlugin
  ): WdaClientPlugin {
    var log = logger.createLogger('wdaClient')
    log.info('WdaClient.js initializing...')

    var socket = new net.Socket()
    var WdaClient: WdaClientPlugin = {
      baseUrl: iosutil.getUri(options.wdaHost, options.wdaPort)
    , sessionId: null
    , ownSession: false
    , deviceSize: null
    , orientation: null
    , touchDownParams: {}
    , tapStartAt: 0
    , typeKeyActions: []
    , typeKeyTimerId: null
    , typeKeyDelay: 250
    , upperCase: false
    , isSwiping: false
    , isRotating: false
    , deviceType: null

    , getDeviceType: function() {
        if (this.deviceType !== null) {
          return this.deviceType
        }

        return devicestate.type().then((deviceType) => {
          this.deviceType = deviceType
          return this.deviceType
        }).catch(function(err: Error) {
          log.warn('Unable to get the device type from WDA: %s', err.message)
          return null
        })
      }

    , startSession: function() {
        log.info('verifying wda session status...')

        this.getDeviceType()

        return activeOrNewSession(this.baseUrl, (requestOpt) => this.handleRequest(requestOpt))
          .then((session) => {
            this.sessionId = session.response.sessionId
            this.ownSession = session.created
            log.info(`${session.created ? 'started' : 'reusing'} wda session: ${this.sessionId}`)

            this.setVersion(session.response)
            if (this.deviceType !== 'Apple TV') {
              this.getOrientation()
              this.batteryIosEvent()
            }
            this.setStatus(3)
            // Fork (Zebrunner): a session STF created gets the settings of WDA for its UI, a
            // session of Appium keeps its own (WDA resets them in every new session)
            return startFastInput(this.baseUrl, this.sessionId!, session.created)
          })
          .then(() => {
            return this.size()
          })
          .catch((err) => {
            log.error('"startSession" No valid response from web driver!', err)
            return Promise.reject(err)
          })
      }

    , stopSession: function() {
        var currentSessionId = this.sessionId
        this.sessionId = null

        // A session of somebody else (an Appium test) is left to its owner
        if (currentSessionId === null || !this.ownSession) {
          // Fork (Zebrunner)
          return stopFastInput()
        }

        log.info('stopping wda session: ', currentSessionId)
        this.ownSession = false
        // Fork (Zebrunner): the default settings of WDA back first
        return stopFastInput().then(() => this.handleRequest({
          method: 'DELETE'
        , uri: `${this.baseUrl}/session/${currentSessionId}`
        }))
      }

    , setStatus: function(status: number) {
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DeviceStatusMessage(
            options.serial
          , status
          , timeutil.now('nano')
          ))
        ])
      }

    , typeKey: function(params) {
        var rawValue = params.value?.[0]
        if (!rawValue) {
          return
        }

        var value = rawValue

        if (this.upperCase) {
          value = value.toUpperCase()
        }

        this.typeKeyActions.push({type: 'keyDown', value: value})
        this.typeKeyActions.push({type: 'keyUp', value: value})

        var handleRequest = () => {
          var requestParams: RpOptions = {
            method: 'POST'
          , uri: `${this.baseUrl}/session/${this.sessionId}/actions`
          , body: {
              actions: [
                {
                  type: 'key'
                , id: 'keyboard'
                , actions: this.typeKeyActions
                }
              ]
            }
          , json: true
          }

          this.typeKeyActions = []
          if (this.typeKeyTimerId) {
            clearTimeout(this.typeKeyTimerId)
            this.typeKeyTimerId = null
          }

          if (this.deviceType !== 'Apple TV') {
            this.handleRequest(requestParams)
            return NO_RESULT
          }

          switch (true) {
            case value === '\v':
              this.pressButton('left')
              return NO_RESULT
            case value === '\f':
              this.pressButton('right')
              return NO_RESULT
            case value === '\0':
              this.pressButton('up')
              return NO_RESULT
            case value === '\x18':
              this.pressButton('down')
              return NO_RESULT
            case value === '\r':
              this.pressButton('select')
              return NO_RESULT
            default:
              return NO_RESULT
          }
        }

        if (value === ' ') {
          handleRequest()
        }
        else {
          if (this.typeKeyTimerId) {
            clearTimeout(this.typeKeyTimerId)
          }

          this.typeKeyTimerId = setTimeout(handleRequest, this.typeKeyDelay)
        }
      }

    , tap: function(params: TouchDownIosMessageFields) {
        this.tapStartAt = (new Date()).getTime()
        this.touchDownParams = params
      }

    , homeBtn: function() {
        if (this.deviceType !== 'Apple TV') {
          return this.handleRequest({
            method: 'POST'
          , uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`
          , body: {name: 'home'}
          , json: true
          }).then(() => {
            return this.rotation({orientation: 'PORTRAIT'})
          })
        }

        return this.handleRequest({
          method: 'POST'
        , uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`
        , body: {name: 'menu'}
        , json: true
        })
      }

    , swipe: function(params: TouchMoveIosMessageFields) {
        if (!this.deviceSize) {
          return NO_RESULT
        }
        var scale = iosutil.swipe(this.orientation, params, this.deviceSize)
        var body = {
          actions: [
            {
              type: 'pointer'
            , id: 'finger1'
            , parameters: {pointerType: 'touch'}
            , actions: [
                {type: 'pointerMove', duration: 0, x: scale.fromX, y: scale.fromY}
              , {
                  type: 'pointerMove'
                , duration: scale.duration * 1000
                , x: scale.toX
                , y: (function() {
                    if (scale.fromY < scale.toY) {
                      return scale.toY - (scale.toY / 4)
                    }
                    if (scale.fromY - scale.toY >= 50) {
                      return scale.toY + (scale.toY / 4)
                    }
                    return scale.toY
                  })()
                }
              , {type: 'pointerUp'}
              ]
            }
          ]
        }

        if (this.deviceType === 'Apple TV') {
          log.error('Swipe is not supported')
          return NO_RESULT
        }

        if (!this.isSwiping) {
          this.isSwiping = true
          this.handleRequest({
            method: 'POST'
          , uri: `${this.baseUrl}/session/${this.sessionId}/actions`
          , body: body
          , json: true
          }).then((response) => {
            log.info('swipe response: ', response)
            this.isSwiping = false
          })
        }
        return NO_RESULT
      }

    , touchUp: function() {
        if (this.isSwiping || !this.deviceSize) {
          return NO_RESULT
        }

        var x = this.touchDownParams.x
        var y = this.touchDownParams.y
        if (typeof x !== 'number' || typeof y !== 'number') {
          return NO_RESULT
        }

        x *= this.deviceSize.width
        y *= this.deviceSize.height

        if (((new Date()).getTime() - this.tapStartAt) <= 1000 || !this.tapStartAt) {
          var body = {
            actions: [
              {
                type: 'pointer'
              , id: 'finger1'
              , parameters: {pointerType: 'touch'}
              , actions: [
                  {
                    type: 'pointerMove'
                  , duration: 0
                  , x: this.orientation === 'PORTRAIT' ? x : y
                  , y: this.orientation === 'PORTRAIT' ? y : x
                  }
                  // Fork (Zebrunner): a press instead of a second move, WDA takes a snapshot of
                  // the app for every move (a tap 1.4 s -> 0.9 s)
                , {type: 'pointerDown', button: 0}
                , {type: 'pointerUp', button: 0}
                ]
              }
            ]
          }

          if (this.deviceType !== 'Apple TV') {
            log.info(options.deviceName)
            return this.handleRequest({
              method: 'POST'
            , uri: `${this.baseUrl}/session/${this.sessionId}/actions`
            , body: body
            , json: true
            })
          }

          if (x >= 0 && y >= 0) {
            switch (true) {
              case x < 300:
                return this.pressButton('left')
              case x > 1650:
                return this.pressButton('right')
              case y > 850:
                return this.pressButton('down')
              case y < 250:
                return this.pressButton('up')
              default:
                return this.pressButton('select')
            }
          }
        }
        else {
          if (this.deviceType === 'Apple TV') {
            log.error('Holding tap is not supported')
            return NO_RESULT
          }
          return this.handleRequest({
            method: 'POST'
          , uri: `${this.baseUrl}/session/${this.sessionId}/wda/touchAndHold`
          , body: {x: x, y: y, duration: 1}
          , json: true
          })
        }

        return NO_RESULT
      }

    , doubleClick: function() {
        if (!this.isSwiping && this.deviceSize) {
          var x = this.touchDownParams.x
          var y = this.touchDownParams.y
          if (typeof x !== 'number' || typeof y !== 'number') {
            return NO_RESULT
          }
          var params = {
            x: x * this.deviceSize.width
          , y: y * this.deviceSize.height
          }

          return this.handleRequest({
            method: 'POST'
          , uri: `${this.baseUrl}/session/${this.sessionId}/wda/doubleTap`
          , body: params
          , json: true
          })
        }
        return NO_RESULT
      }

    , size: function() {
        if (this.deviceSize !== null) {
          return this.deviceSize
        }
        log.info('getting device window size...')

        // Fork (Zebrunner): the screen in pixels from WDA (plugins/devicestate), not from the database
        return devicestate.screen().then((screen) => {
          var width = screen.width / screen.scale
          var height = screen.height / screen.scale
          if (this.orientation === 'PORTRAIT' || !this.orientation) {
            this.deviceSize = {height: height, width: width}
          }
          else if (this.orientation === 'LANDSCAPE') {
            this.deviceSize = {height: width, width: height}
          }
          else if (this.deviceType === 'Apple TV') {
            this.deviceSize = {height: screen.height, width: screen.width}
          }
          return this.deviceSize
        })
          .catch(function(err: Error) {
            log.warn('Unable to get the device size from WDA: %s', err.message)
            return null
          })
      }

    , setVersion: function(currentSession: WdaSessionResponse) {
        log.info('Setting current device version: ' + currentSession.value.capabilities.sdkVersion)

        push.send([
          wireutil.global
        , wireutil.envelope(new wire.SdkIosVersion(
            options.serial
          , currentSession.value.capabilities.device
          , currentSession.value.capabilities.sdkVersion
          ))
        ])
      }

    , openUrl: function(message: BrowserOpenMessageFields) {
        return this.handleRequest({
          method: 'POST'
        , uri: `${this.baseUrl}/session/${this.sessionId}/url`
        , body: {url: message.url}
        , json: true
        })
      }

    , screenshot: function() {
        return new Promise<WdaValueResponse<string>>((resolve, reject) => {
          this.handleRequest<WdaValueResponse<string>>({
            method: 'GET'
          , uri: `${this.baseUrl}/screenshot`
          , json: true
          })
            .then(resolve)
            .catch(reject)
        })
      }

    , getOrientation: function() {
        return this.handleRequest<WdaValueResponse<IosOrientation>>({
          method: 'GET'
        , uri: `${this.baseUrl}/session/${this.sessionId}/orientation`
        , json: true
        }).then((orientationResponse) => {
          this.orientation = orientationResponse.value
          log.info('Current device orientation: ' + this.orientation)
        })
      }

    , rotation: function(params: {orientation: IosOrientation}) {
        this.orientation = params.orientation
        this.isRotating = true

        return this.handleRequest({
          method: 'POST'
        , uri: `${this.baseUrl}/session/${this.sessionId}/orientation`
        , body: params
        , json: true
        }).then(() => {
          this.getOrientation()
          this.size()

          var rotationDegrees = iosutil.orientationToDegrees(this.orientation)

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.RotationEvent(
              options.serial
            , rotationDegrees
            ))
          ])

          this.isRotating = false
        })
      }

    , batteryIosEvent: function() {
        return this.handleRequest<WdaValueResponse<WdaBatteryInfo>>({
          method: 'GET'
        , uri: `${this.baseUrl}/session/${this.sessionId}/wda/batteryInfo`
        , json: true
        })
          .then((batteryInfoResponse) => {
            var batteryState = iosutil.batteryState(batteryInfoResponse.value.state)
            var batteryLevel = iosutil.batteryLevel(batteryInfoResponse.value.level)

            push.send([
              wireutil.global
              // Fork (Zebrunner): WDA knows no health or temperature, go-ios tells them
              // (plugins/info), the empty ones keep what it stored
            , wireutil.envelope(new wire.BatteryIosEvent(
                options.serial
              , ''
              , 'usb'
              , batteryState
              , batteryLevel
              , ''
              , 100
              ))
            ])
          })
          .then(function() {
            log.info('Setting new device battery info')
          })
          .catch(function(err) {
            log.info(err)
          })
      }

    , getTreeElements: function() {
        return this.handleRequest({
          method: 'GET'
        , uri: `${this.baseUrl}/source?format=json`
        , json: true
        })
      }

    , pressButton: function(params: string) {
        return this.handleRequest({
          method: 'POST'
        , uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`
        , body: {name: params}
        , json: true
        })
      }

    , switchCharset: function() {
        this.upperCase = !this.upperCase
        log.info(this.upperCase)
      }

    , appActivate: function(params: string) {
        return this.handleRequest({
          method: 'POST'
        , uri: `${this.baseUrl}/session/${this.sessionId}/wda/apps/activate`
        , body: {bundleId: params}
        , json: true
        })
      }

    , pressPower: function() {
        return this.handleRequest<WdaValueResponse<boolean>>({
          method: 'GET'
        , uri: `${this.baseUrl}/session/${this.sessionId}/wda/locked`
        , json: true
        })
          .then((response) => {
            var targetUrl = `${this.baseUrl}/session/${this.sessionId}/wda/lock`
            if (response.value === true) {
              targetUrl = `${this.baseUrl}/session/${this.sessionId}/wda/unlock`
            }
            return this.handleRequest({
              method: 'POST'
            , uri: targetUrl
            , json: true
            })
          })
      }

    , handleRequest: function<T = unknown>(requestOpt: RpOptions) {
        return new Promise<T>((resolve) => {
          request<T>(requestOpt)
            .then((response) => {
              log.verbose(LOG_REQUEST_MSG, JSON.stringify(requestOpt))
              resolve(response)
            })
            .catch((err: unknown) => {
              var errMes = getErrorMessage(err)

              if (
                errMes.includes('Timed out while waiting until the screen gets locked') ||
                errMes.includes('unlocked')
              ) {
                return
              }

              if (errMes.includes('Unable To Rotate Device')) {
                log.info('The current application does not support rotation')
                return
              }

              // Fork (Zebrunner): a session can also end while a request is pending (an Appium
              // test ends, STF closes the screen); only the loss of the current session starts
              // the next one, a request of an older session is dropped
              if (
                errMes.includes('Session does not exist') ||
                errMes.includes('was deleted while this request was still pending')
              ) {
                var current = this.sessionId !== null &&
                  String(requestOpt.uri || '').includes(`/session/${this.sessionId}`)
                if (current) {
                  this.startSession()
                }
                return
              }

              notifier.setDeviceAbsent(err)
              lifecycle.fatal(err)
            })
        })
      }
    }

    function connectToWdaMjpeg(connectOptions: IosDeviceOptions) {
      log.info('connecting to WdaMjpeg')
      socket.connect(connectOptions.connectPort, connectOptions.wdaHost, function() {
        log.info(
          `Connected to WdaMjpeg ${connectOptions.wdaHost}:${connectOptions.connectPort}`
        )
      })

      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceStatusMessage(
          connectOptions.serial
        , 6
        , timeutil.now('nano')
        ))
      ])
    }

    function wdaMjpegCloseEventHandler(hadError: boolean) {
      log.info(`WdaMjpeg connection was closed${hadError ? ' by error' : ''}`)
      notifier.setDeviceAbsent('WdaMjpeg connection is lost')
      lifecycle.fatal('WdaMjpeg connection is lost')

      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceStatusMessage(
          options.serial
        , 3
        , timeutil.now('nano')
        ))
      ])
    }

    socket.on('close', wdaMjpegCloseEventHandler)
    connectToWdaMjpeg(options)

    return WdaClient
  })
