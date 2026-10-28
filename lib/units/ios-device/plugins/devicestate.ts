/**
* Fork (Zebrunner): the type of the device (iPhone or Apple TV), its screen and its iOS version,
* which the unit took from the database of STF and from a WDA session it created at the first join
* before. WebDriverAgent tells them without a session: they are read when the unit starts (again
* while it fails) and sent to the processor, which stores them for the API (/devices/{serial}/size
* and /type), the grid and the UI. So the device units need no database.
**/

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import request from './util/rp.js'
import iosutil from './util/iosutil.js'
import pushSyrup from '../support/push.js'
import type {
  IosDeviceOptions
, Push
, WdaScreenInfo
, WdaValueResponse
, WdaWindowSize
} from '../../../types/ios-device.js'

export const APPLE_TV = 'Apple TV'

const REQUEST_TIMEOUT = 10000

// The screen in pixels: portrait for a phone or a tablet, as the WDA client expects
export interface IosScreen {
  width: number
  height: number
  scale: number
}

export interface IosDeviceStatePlugin {
  type(): Promise<string>
  screen(): Promise<IosScreen>
  // sends the type, the screen and the version to the processor, never rejects
  report(): Promise<void>
}

interface WdaDeviceInfo {
  model?: string
  name?: string
}

interface WdaStatus {
  device?: string
  os?: {
    version?: string
  }
}

export function deviceTypeOf(info: WdaDeviceInfo): string {
  var model = String(info.model || '').toLowerCase()
  var name = String(info.name || '').toLowerCase()
  return model.includes('tv') || name.includes('tv') ? APPLE_TV : 'iPhone'
}

export function screenOf(deviceType: string, size: WdaWindowSize, info: WdaScreenInfo): IosScreen {
  var scale = Number(info.scale)
  var width = Number(size.width) * scale
  var height = Number(size.height) * scale
  if (!(width > 0 && height > 0 && scale > 0)) {
    throw new Error(`Invalid screen of WDA: ${JSON.stringify({size: size, info: info})}`)
  }
  if (deviceType !== APPLE_TV && width > height) {
    return {width: height, height: width, scale: scale}
  }
  return {width: width, height: height, scale: scale}
}

export default syrup.serial()
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, push: Push): IosDeviceStatePlugin {
    var log = logger.createLogger('device:plugins:devicestate')
    var baseUrl = iosutil.getUri(options.wdaHost, options.wdaPort)
    var cache: Record<string, Promise<unknown>> = {}

    function get<T>(path: string): Promise<T> {
      return request<WdaValueResponse<T>>({
        method: 'GET'
      , uri: `${baseUrl}${path}`
      , json: true
      , timeout: REQUEST_TIMEOUT
      })
        .then(function(response) {
          return response.value
        })
    }

    // the value of a read, read again after a failure
    function once<T>(name: string, read: () => Promise<T>): Promise<T> {
      if (!cache[name]) {
        var promise = read()
        cache[name] = promise
        promise.catch(function() {
          if (cache[name] === promise) {
            delete cache[name]
          }
        })
      }
      return cache[name] as Promise<T>
    }

    function type() {
      return once('type', function() {
        return get<WdaDeviceInfo>('/wda/device/info').then(deviceTypeOf)
      })
    }

    function screen() {
      return once('screen', function() {
        return Promise.all([
          type()
        , get<WdaWindowSize>('/window/size')
        , get<WdaScreenInfo>('/wda/screen')
        ])
          .then(function([deviceType, size, info]) {
            return screenOf(deviceType, size, info)
          })
      })
    }

    function status() {
      return once('status', function() {
        return get<WdaStatus>('/status')
      })
    }

    function report() {
      return Promise.all([type(), screen(), status()])
        .then(function([deviceType, display, wdaStatus]) {
          log.info('Device type "%s", screen %dx%d, scale %d'
          , deviceType, display.width, display.height, display.scale)
          push.send([
            wireutil.global
          , wireutil.envelope(new wire.IosDeviceScreenMessage(
              options.serial
            , deviceType
            , display.width
            , display.height
            , display.scale
            ))
          ])
          if (wdaStatus.device && wdaStatus.os?.version) {
            push.send([
              wireutil.global
            , wireutil.envelope(new wire.SdkIosVersion(
                options.serial
              , wdaStatus.device
              , wdaStatus.os.version
              ))
            ])
          }
        })
        .catch(function(err: Error) {
          log.warn('Unable to read the type and the screen of the device from WDA, ' +
            'they are read again when the device is used: %s', err.message)
        })
    }

    // WDA is up when the unit starts (mcloud-device waits for it), the result is not waited for
    report()

    return {
      type: type
    , screen: screen
    , report: report
    }
  })
