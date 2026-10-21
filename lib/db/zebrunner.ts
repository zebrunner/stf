/**
* Fork (Zebrunner): the database methods of the iOS/tvOS devices and of the status API of the
* devices. lib/db/api.ts adds them to dbapi with extendDbApi(), so the upstream file only gets a
* line for them.
**/

import r from 'rethinkdb'
import Promise from 'bluebird'

import type {DeviceDocument, DeviceGroup, GroupDocument} from '../types/stf.js'
import type {
  BatteryIosEventFields
, InitializeIosDeviceStateFields
, IosDeviceInfoMessageFields
, IosNetworkEventFields
, SdkIosVersionFields
} from '../types/wire.js'

type DbApi = typeof import('./api.js')['default']
type Db = typeof import('./index.js')['default']

// iosNetwork <message>: the network field of a device for an IosNetworkEvent
export function iosNetwork(message: IosNetworkEventFields) {
  var wifi = Boolean(message.ssid)
  return {
    connected: message.connected
  , type: message.type || null
  , ssid: wifi ? message.ssid : null
  , rssi: wifi ? message.rssi : null
  , snr: wifi && typeof message.snr === 'number' ? message.snr : null
  , channel: wifi ? message.channel : null
  , bandwidth: wifi ? message.bandwidth : null
  }
}

export interface SessionDocument {
  id: string
  email: string
  // ms since the epoch
  expiresAt: number
}

export interface ZebrunnerDbApi {
  saveSession(session: SessionDocument): Promise<void>
  loadSession(id: string): Promise<SessionDocument | null>
  deleteSession(id: string): Promise<r.WriteResult>
  setDeviceStatusOverride(serial: string, status: number): Promise<r.WriteResult>
  markDeviceAsUsing(serial: string): Promise<r.WriteResult>
  unmarkDeviceAsUsing(serial: string): Promise<r.WriteResult>
  setDeviceIosBattery(message: BatteryIosEventFields): Promise<r.WriteResult>
  setIosDeviceInfo(message: IosDeviceInfoMessageFields): Promise<r.WriteResult>
  setIosNetwork(message: IosNetworkEventFields): Promise<r.WriteResult>
  setDeviceIosVersion(message: SdkIosVersionFields): Promise<void>
  sizeIosDevice(
    serial: string
  , height: number
  , width: number
  , scale: number
  ): Promise<r.WriteResult>
  getDeviceSize(serial: string): Promise<DeviceDocument['display'] | null>
  getDeviceGroupOwner(serial: string): Promise<DeviceGroup['owner'] | null>
  setDeviceGroupOwner(message: {serial: string}): Promise<r.WriteResult>
  setDeviceType(serial: string, type: string): Promise<r.WriteResult>
  getDeviceType(serial: string): Promise<string | null | undefined>
  initializeIosDeviceState(
    publicIp: string
  , message: InitializeIosDeviceStateFields
  ): Promise<r.WriteResult | GroupDocument | null>
}

// db is passed in rather than imported, so the module follows the db of lib/db/api.ts
export default function extendDbApi(dbapi: DbApi, db: Db) {
  // The sessions of lib/util/authsession.ts; a new session also drops the expired ones of the user
  dbapi.saveSession = function(session) {
    return db.run(r.table('sessions').insert(session))
      .then(function() {
        return db.run(r.table('sessions').getAll(session.email, {index: 'email'})
          .filter(r.row('expiresAt').lt(Date.now()))
          .delete())
      })
      .then(function() {})
  }

  dbapi.loadSession = function(id) {
    return db.run(r.table('sessions').get<SessionDocument>(id))
  }

  dbapi.deleteSession = function(id) {
    return db.run(r.table('sessions').get<SessionDocument>(id).delete())
  }

  // Administrative status change from the REST API. Unlike saveDeviceStatus it does not compare
  // timestamps, which come from the device units' monotonic clock and can't be produced here.
  dbapi.setDeviceStatusOverride = function(serial, status) {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({
      status: status
    , statusChangedAt: r.now()
    }))
  }

  dbapi.markDeviceAsUsing = function(serial) {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({
      using: true
    }))
  }

  dbapi.unmarkDeviceAsUsing = function(serial) {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({
      using: false
    }))
  }

  // The battery from WDA (level and state) or go-ios (also health, temperature and voltage): an
  // empty field is not known and keeps the stored one
  dbapi.setDeviceIosBattery = function(message) {
    var battery: Record<string, unknown> = {
      source: message.source
    , status: message.status
    , level: message.level
    , scale: message.scale
    }
    if (message.health) {
      battery.health = message.health
    }
    if (message.temp && message.temp !== 'n/a') {
      battery.temp = Number(message.temp)
    }
    if (typeof message.voltage === 'number') {
      battery.voltage = message.voltage
    }
    return db.run(r.table('devices').get<DeviceDocument>(message.id).update({
      battery: battery
    }))
  }

  // What go-ios reads from lockdown (plugins/info of the ios-device unit), the fields it knows
  dbapi.setIosDeviceInfo = function(message) {
    var info: Record<string, unknown> = {}
    ;(['manufacturer', 'product', 'version', 'sdk', 'abi', 'cpuPlatform', 'operator'] as const)
      .forEach(function(field) {
        if (message[field]) {
          info[field] = message[field]
        }
      })
    if (message.phone) {
      var phone: Record<string, string> = {}
      ;(['imei', 'imsi', 'phoneNumber', 'iccid', 'network'] as const).forEach(function(field) {
        if (message.phone![field]) {
          phone[field] = message.phone![field]!
        }
      })
      info.phone = phone
    }
    if (message.rom) {
      info.memory = {rom: message.rom}
    }
    return db.run(r.table('devices').get<DeviceDocument>(message.serial).update(info))
  }

  // The network of an iOS device from its system log; the Wi-Fi fields are null without a link
  dbapi.setIosNetwork = function(message) {
    return db.run(r.table('devices').get<DeviceDocument>(message.serial).update({
      network: iosNetwork(message)
    }))
  }

  dbapi.setDeviceIosVersion = function(message) {
    return db.run(r.table('devices').get<DeviceDocument>(message.id))
      .then(function(device) {
        if (!device) {
          return
        }
        // Not awaited on purpose, as before: the version is informational
        db.run(r.table('devices').get<DeviceDocument>(message.id).update({
          version: message.sdkVersion
        , model: `${device.model}`
        , provider: {
            name: `${device.provider.name}`
          }
        }))
      })
  }

  dbapi.sizeIosDevice = function(serial, height, width, scale) {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({
      display: {
        height: height
      , width: width
      , scale: scale
      }
    }))
  }

  dbapi.getDeviceSize = function(serial) {
    return db.run(r.table('devices').get<DeviceDocument>(serial)).then(function(device) {
      return device ? device.display : null
    })
  }

  dbapi.getDeviceGroupOwner = function(serial) {
    return db.run(r.table('devices').get<DeviceDocument>(serial)).then(function(device) {
      return device ? device.group.owner : null
    })
  }

  dbapi.setDeviceGroupOwner = function(message) {
    return db.run(r.table('devices').get<DeviceDocument>(message.serial).update({
      group: {
        owner: {
          email: process.env.STF_ADMIN_EMAIL || 'administrator@fakedomain.com'
        , name: process.env.STF_ADMIN_NAME || 'administrator'
        }
      }
    }))
  }

  dbapi.setDeviceType = function(serial, type) {
    return db.run(r.table('devices').get<DeviceDocument>(serial).update({
      deviceType: type
    }))
  }

  dbapi.getDeviceType = function(serial) {
    return db.run(r.table('devices').get<DeviceDocument>(serial)).then(function(device) {
      return device ? device.deviceType : null
    })
  }

  dbapi.initializeIosDeviceState = function(publicIp, message) {
    var screenWsUrlPattern =
      message.provider.screenWsUrlPattern || `ws://${publicIp}:${message.ports.screenPort}/`

    var data = {
      present: true
    , presenceChangedAt: r.now()
    , provider: message.provider
    , owner: null
    , status: message.status
    , statusChangedAt: r.now()
      // Reset on each (re)initialization so DeviceStatusMessages from the new ios-device process are
      // not discarded as stale
    , statusTimeStamp: 0
    , ready: true
    , reverseForwards: []
    , remoteConnect: false
    , remoteConnectUrl: null
    , usage: null
    , ios: true
    , iosClientChannel: message.serial
    // Fork (Zebrunner): the screen of an iOS device: its size comes from WDA, the rest of its model
    // (lib/util/zebrunner-ios-models.ts); Android fields that iOS has no counterpart for are cleared
    , display: {
        density: null
      , fps: null
      , id: null
      , rotation: 0
      , secure: null
      , size: null
      , xdpi: null
      , ydpi: null
      , url: screenWsUrlPattern
      }
    , group: {
        owner: {
          email: 'administrator@fakedomain.com'
        , name: 'administrator'
        }
      }
    , screenPort: message.ports.screenPort
    , connectPort: message.ports.connectPort
    , model: message.options.name
    , platform: message.options.platform
    , sdk: message.options.architect
    }

    return db.run(r.table('devices').get<DeviceDocument>(message.serial).update(data))
      .then(function(stats): Promise<r.WriteResult | GroupDocument | null> {
        if (stats.skipped) {
          return dbapi.getRootGroup().then(function(group) {
            var row = Object.assign({}, data, {
              serial: message.serial
            , createdAt: r.now()
            , group: {
                id: group.id
              , name: group.name
              , lifeTime: group.dates[0]!
              , owner: group.owner
              , origin: group.id
              , class: group.class
              , repetitions: group.repetitions
              , originName: group.name
              , lock: false
              }
            })

            return db.run(r.table('devices').insert(row))
              .then(function() {
                return dbapi.addOriginGroupDevice(group, message.serial)
              })
          })
        }

        dbapi.setDeviceGroupOwner(message)

        return Promise.resolve(stats)
      })
  }
}
