// Fork (Zebrunner): loads the WDA client of the ios-device unit with its STF side faked (database,
// ZeroMQ, lifecycle), for the tests against a fake WDA (test/units/zebrunner/) and a real one on
// an iOS simulator (test/zebrunner-ios/)
import syrup from '@devicefarmer/stf-syrup'

import wire from '../../lib/wire/index.js'
import type {WdaClientPlugin} from '../../lib/types/ios-device.js'
import {importFresh, mockModule} from './module-mock.mts'

export interface Display {
  height: number
  width: number
  scale: number
}

export interface IosWda {
  client: WdaClientPlugin
  // The wire messages the client sent, decoded
  sent(): Array<{type: string, message: any}>
  // The errors that would have stopped the unit
  fatal: unknown[]
  absent: unknown[]
  setDisplay(display: Display | null): void
}

export interface IosWdaOptions {
  serial: string
  wdaHost: string
  wdaPort: number
  // The port of the MJPEG server of WDA, the unit connects to it at start
  connectPort: number
  deviceType?: string
}

var lib = new URL('../../lib/', import.meta.url)

function module(path: string) {
  return new URL(path, lib)
}

export async function loadWdaClient(options: IosWdaOptions): Promise<IosWda> {
  var pushed: unknown[][] = []
  var fatal: unknown[] = []
  var absent: unknown[] = []
  var display: Display | null = null

  var restores = [
    mockModule(module('db/index.js'), {default: {}})
  , mockModule(module('db/api.js'), {default: {
      getDeviceType: function() {
        return Promise.resolve(options.deviceType || 'iPhone')
      }
    , getDeviceSize: function() {
        return Promise.resolve(display)
      }
    }})
  , mockModule(module('util/lifecycle.js'), {default: {
      fatal: function(err: unknown) {
        fatal.push(err)
      }
    , graceful: function() {}
    , observe: function() {}
    , share: function() {}
    }})
  , mockModule(module('units/ios-device/plugins/devicenotifier.js'), {
      default: syrup.serial().define(function() {
        return {
          setDeviceAbsent: function(err: unknown) {
            absent.push(err)
          }
        }
      })
    })
  , mockModule(module('units/ios-device/support/push.js'), {
      default: syrup.serial().define(function() {
        return {
          send: function(message: unknown[]) {
            pushed.push(message)
          }
        }
      })
    })
  ]
  var client: WdaClientPlugin
  try {
    var wdaClient = (await importFresh(module('units/ios-device/plugins/wda/WdaClient.js'))).default
    client = await wdaClient.consume({
      serial: options.serial
    , deviceName: 'test device'
    , wdaHost: options.wdaHost
    , wdaPort: options.wdaPort
    , connectPort: options.connectPort
    }) as WdaClientPlugin
  }
  finally {
    restores.forEach(function(restore) {
      restore()
    })
  }

  return {
    client: client
  , fatal: fatal
  , absent: absent
  , setDisplay: function(value) {
      display = value
    }
  , sent: function() {
      return pushed.map(function(message) {
        var envelope = wire.Envelope.decode(message[1] as Buffer)
        var type = wire.ReverseMessageType[envelope.type]!
        var decoder = wire[type] as unknown as {decode(body: unknown): unknown}
        return {type: type, message: decoder.decode(envelope.message)}
      })
    }
  }
}
