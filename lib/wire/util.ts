//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

/* global BigInt */
/* eslint no-extend-native: ["error", { "exceptions": ["BigInt"] }] */

(BigInt.prototype as BigInt & {toJSON: () => number}).toJSON = function() {
  return Number(this)
}

import * as uuid from 'uuid'

import wire from './index.js'
import type {DeviceStatusValues, RequirementTypeValues} from '../types/wire.js'

interface WireMessage {
  $code: number
  encode(): Buffer
}

interface DeviceRequirementSpec {
  value: string
  match: string
}

interface Reply {
  okay(data?: string | null, body?: unknown): Buffer
  fail(data?: string, body?: unknown): Buffer
  progress(data?: string, progress?: number): Buffer
  tree(data?: string | null, body?: unknown): Buffer
  device(data?: string | null, body?: unknown): Buffer
}

interface InstalledApp {
  bundleId: string
  bundleName: string
}

var wireutil = {
  global: '*ALL'
, makePrivateChannel: function() {
    return uuid.v4(null as unknown as undefined, Buffer.alloc(16)).toString('base64')
  }
, toDeviceStatus: function(type: string): number | undefined {
    return wire.DeviceStatus[({
      device: 'ONLINE'
    , emulator: 'ONLINE'
    , unauthorized: 'UNAUTHORIZED'
    , offline: 'OFFLINE'
    , connecting: 'CONNECTING'
    , authorizing: 'AUTHORIZING'
    } as Record<string, keyof DeviceStatusValues>)[type]!]
  }
, toDeviceRequirements: function(requirements: Record<string, DeviceRequirementSpec>) {
    return Object.keys(requirements).map(function(name) {
      var item = requirements[name]!
      return new wire.DeviceRequirement(
        name
      , item.value
      , wire.RequirementType[item.match.toUpperCase() as keyof RequirementTypeValues]
      )
    })
  }
, toInstalledApps: function(installedApps: InstalledApp[]) {
    return installedApps.map(function(instApp) {
      return new wire.Applications(
        instApp.bundleId
      , instApp.bundleName
      )
    })
  }
, envelope: function(message: WireMessage) {
    return new wire.Envelope(message.$code, message.encode()).encodeNB()
  }
, transaction: function(channel: string, message: WireMessage) {
    return new wire.Envelope(
        message.$code
      , message.encode()
      , channel
      )
      .encodeNB()
  }
, reply: function(source: string): Reply {
    var seq = 0
    return {
      okay: function(data?: string | null, body?: unknown) {
        return wireutil.envelope(new wire.TransactionDoneMessage(
          source
        , seq++
        , true
        , data === null ? null : (data || 'success')
        , body ? JSON.stringify(body) : null
        ))
      }
    , fail: function(data?: string, body?: unknown) {
        return wireutil.envelope(new wire.TransactionDoneMessage(
          source
        , seq++
        , false
        , data || 'fail'
        , body ? JSON.stringify(body) : null
        ))
      }
    , progress: function(data?: string, progress?: number) {
        return wireutil.envelope(new wire.TransactionProgressMessage(
          source
        , seq++
        , data
        , ~~(progress as number)
        ))
      }
    , tree: function(data?: string | null, body?: unknown) {
        return wireutil.envelope(new wire.TransactionTreeMessage(
          source
        , seq++
        , true
        , data === null ? null : (data || 'success')
        , body ? JSON.stringify(body) : null
        ))
      }
    , device: function(_data?: string | null, body?: unknown) {
        return wireutil.envelope(new wire.TransationGetMessage(
          source
        , body ? JSON.stringify(body) : null
        ))
      }
    }
  }
}

namespace wireutil {
  export type Message = WireMessage
  export type TransactionReply = Reply
  export type RequirementSpec = DeviceRequirementSpec
  export type InstalledApplication = InstalledApp
}

export default wireutil
