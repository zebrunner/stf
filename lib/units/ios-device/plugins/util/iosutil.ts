import Promise from 'bluebird'

import logger from '../../../../util/logger.js'
// Fork (Zebrunner)
import {isWdaButton} from '../wda/navigation.js'
import type {
  IosDeviceSize
, IosOrientation
, IosPressButtonContext
, IosSwipeResult
} from '../../../../types/ios-device.js'
import type {TouchMoveIosMessageFields} from '../../../../types/wire.js'

var log = logger.createLogger('iosutil')

function asciiparser(key: string): string | null {
  switch (key) {
    case 'tab':
      return '\x09'
    case 'enter':
      return '\r'
    case 'del':
      return '\x08'
    case 'dpad_left':
      return '\v'
    case 'dpad_up':
      return '\0'
    case 'dpad_right':
      return '\f'
    case 'dpad_down':
      return '\x18'
    case 'caps_lock':
    case 'escape':
    case 'home':
      return null
    default:
      return key
  }
}

function degreesToOrientation(degree: number): IosOrientation | undefined {
  var orientation: IosOrientation | undefined

  switch (degree) {
    case 0:
      orientation = 'PORTRAIT'
      break
    case 90:
      orientation = 'LANDSCAPE'
      break
    case 180:
      orientation = 'UIA_DEVICE_ORIENTATION_PORTRAIT_UPSIDEDOWN'
      break
    case 270:
      orientation = 'UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT'
      break
  }

  return orientation
}

function orientationToDegrees(orientation: IosOrientation | null): number | undefined {
  var degrees: number | undefined

  switch (orientation) {
    case 'PORTRAIT':
      degrees = 0
      break
    case 'LANDSCAPE':
      degrees = 90
      break
    case 'UIA_DEVICE_ORIENTATION_PORTRAIT_UPSIDEDOWN':
      degrees = 180
      break
    case 'UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT':
      degrees = 270
      break
  }

  return degrees
}

function pressButton(this: IosPressButtonContext, key: string): unknown {
  switch (key) {
    case 'settings':
      if (this.deviceType === 'Apple TV') {
        return this.appActivate('com.apple.TVSettings')
      }
      return this.appActivate('com.apple.Preferences')
    case 'store':
      if (this.deviceType === 'Apple TV') {
        return this.appActivate('com.apple.TVAppStore')
      }
      return this.appActivate('com.apple.AppStore')
    case 'volume_up':
      return this.pressButton('volumeUp')
    case 'volume_down':
      return this.pressButton('volumeDown')
    case 'power':
      return this.pressPower()
    case 'camera':
      return this.appActivate('com.apple.camera')
    case 'search':
      if (this.deviceType === 'Apple TV') {
        return this.appActivate('com.apple.TVSearch')
      }
      return this.appActivate('com.apple.mobilesafari')
    case 'finder':
      return this.appActivate('com.apple.findmy')
    case 'home':
      return this.homeBtn()
    case 'mute': {
      for (var i = 0; i < 16; i++) {
        Promise.delay(1000).then(() => {
          this.pressButton('volumeDown')
        })
      }
      return true
    }
    case 'switch_charset':
      return this.switchCharset()
    case 'media_play_pause':
    case 'media_stop':
    case 'media_next':
    case 'media_previous':
    case 'media_fast_forward':
    case 'media_rewind':
      return log.error('Non-existent button in WDA')
    default:
      // Fork (Zebrunner): WDA fails on a button the device has not, which stopped the unit
      if (!isWdaButton(key, this.deviceType)) {
        log.warn('The button %s is not supported on iOS', key)
        return null
      }
      return this.pressButton(key)
  }
}

function swipe(
  orientation: IosOrientation | null
, params: TouchMoveIosMessageFields
, deviceSize: IosDeviceSize
): IosSwipeResult {
  var fromX = params.fromX
  var fromY = params.fromY
  var toX = params.toX
  var toY = params.toY

  if (toX >= 2 || toY >= 2) {
    if (fromY >= 0.5) {
      fromY /= 2
      toY = 0.25
    }
    else {
      fromY *= 2
      toY = 0.75
    }

    if (fromX >= 0.5) {
      fromX /= 2
      toX = 0.25
    }
    else {
      fromX *= 2
      toX = 0.75
    }
  }

  switch (orientation) {
    case 'LANDSCAPE':
      return {
        fromX: fromY * deviceSize.height
      , fromY: fromX * deviceSize.width
      , toX: toY * deviceSize.height
      , toY: toX * deviceSize.width
      , duration: params.duration || 0
      }
    case 'PORTRAIT':
    default:
      return {
        fromX: fromX * deviceSize.width
      , fromY: fromY * deviceSize.height
      , toX: toX * deviceSize.width
      , toY: toY * deviceSize.height
      , duration: params.duration || 0
      }
  }
}

function getUri(host: string, port: number): string {
  return `http://${host}:${port}`
}

function batteryState(state: number): string | undefined {
  var status: string | undefined

  switch (state) {
    case 0:
      status = 'full'
      break
    case 1:
      status = 'unplugged'
      break
    case 2:
      status = 'charging'
      break
    case 3:
      status = 'full'
      break
  }

  return status
}

function batteryLevel(level: number): number {
  switch (level) {
    case -1:
      return 100
    default:
      return parseInt(String(level * 100), 10)
  }
}

export default {
  asciiparser
, degreesToOrientation
, orientationToDegrees
, pressButton
, swipe
, getUri
, batteryState
, batteryLevel
}
