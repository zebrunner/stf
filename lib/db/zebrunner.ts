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
, SdkIosVersionFields
} from '../types/wire.js'

type DbApi = typeof import('./api.js')['default']
type Db = typeof import('./index.js')['default']

// Display defaults reported for iOS devices until WDA tells the real size
const DEFAULT_IOS_DEVICE_ARGS = {
  DENSITY: 2
, FPS: 60
, ID: 0
, ROTATION: 0
, SECURE: true
, SIZE: 4.971253395080566
, XDPI: 294.9670104980469
, YDPI: 295.56298828125
}

export interface ZebrunnerDbApi {
  setDeviceStatusOverride(serial: string, status: number): Promise<r.WriteResult>
  markDeviceAsUsing(serial: string): Promise<r.WriteResult>
  unmarkDeviceAsUsing(serial: string): Promise<r.WriteResult>
  setDeviceIosBattery(message: BatteryIosEventFields): Promise<r.WriteResult>
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

  dbapi.setDeviceIosBattery = function(message) {
    return db.run(r.table('devices').get<DeviceDocument>(message.id).update({
      battery: {
        health: message.health
      , source: message.source
      , status: message.status
      , level: message.level
      , temp: message.temp
      , scale: message.scale
      }
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
    , display: {
        density: DEFAULT_IOS_DEVICE_ARGS.DENSITY
      , fps: DEFAULT_IOS_DEVICE_ARGS.FPS
      , id: DEFAULT_IOS_DEVICE_ARGS.ID
      , rotation: DEFAULT_IOS_DEVICE_ARGS.ROTATION
      , secure: DEFAULT_IOS_DEVICE_ARGS.SECURE
      , size: DEFAULT_IOS_DEVICE_ARGS.SIZE
      , xdpi: DEFAULT_IOS_DEVICE_ARGS.XDPI
      , ydpi: DEFAULT_IOS_DEVICE_ARGS.YDPI
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
