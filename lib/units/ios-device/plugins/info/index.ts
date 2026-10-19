import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import wireutil from '../../../../wire/util.js'
import wire from '../../../../wire/index.js'
import logger from '../../../../util/logger.js'
import type {IosDeviceOptions, IosInfoPlugin, Push} from '../../../../types/ios-device.js'
import type {
  BatteryIosEventFields
, DevicePhoneMessageFields
, IosDeviceInfoMessageFields
} from '../../../../types/wire.js'
import pushSyrup from '../../support/push.js'
import {
  execGoIos
, parseBattery
, parseDeviceInfo
, parseDiskSpace
} from '../util/goios.js'

// How often the battery is read again through go-ios
var BATTERY_INTERVAL = 5 * 60 * 1000

// compact <values>: the fields of a wire message that are known
function compact<T>(values: {[K in keyof T]?: T[K] | null}): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(function(entry) {
    return entry[1] !== null && typeof entry[1] !== 'undefined'
  })) as Partial<T>
}

export default syrup.serial()
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, push: Push): IosInfoPlugin {
    var log = logger.createLogger('device:info')
    var batteryTimer: NodeJS.Timeout | null = null

    // Fork (Zebrunner): what lockdown tells through go-ios (hardware, SIM, storage, battery) for the
    // Info tab; a device without usbmuxd (WIRELESS=true) has none of it
    function sendLockdownInfo() {
      return Promise.all([
        execGoIos(options.serial, ['info']).then(function(result) {
          return parseDeviceInfo(result.stdout)
        })
      , execGoIos(options.serial, ['diskspace'])
          .then(function(result) {
            return parseDiskSpace(result.stdout)
          })
          .catch(function() {
            return null
          })
      ])
        .then(function([info, rom]) {
          if (!info) {
            return
          }
          push.send([
            wireutil.global
          , wireutil.envelope(new wire.IosDeviceInfoMessage(compact<IosDeviceInfoMessageFields>({
              serial: options.serial
            , manufacturer: info.manufacturer
            , product: info.product
            , version: info.version
            , sdk: info.sdk
            , abi: info.abi
            , cpuPlatform: info.cpuPlatform
            , operator: info.operator
            , phone: new wire.DevicePhoneMessage(compact<DevicePhoneMessageFields>(info.phone))
            , rom: rom
            })))
          ])
        })
        .catch(function(err) {
          log.warn('go-ios cannot read the device info: %s', err.message)
        })
    }

    function sendBattery() {
      return execGoIos(options.serial, ['batteryregistry'])
        .then(function(result) {
          var battery = parseBattery(result.stdout)
          if (!battery) {
            return
          }
          push.send([
            wireutil.global
          , wireutil.envelope(new wire.BatteryIosEvent(compact<BatteryIosEventFields>({
              id: options.serial
            , health: battery.health
            , source: 'usb'
            , status: battery.status
            , level: battery.level
            , temp: battery.temp
            , scale: 100
            , voltage: battery.voltage
            })))
          ])
        })
        .catch(function(err) {
          log.warn('go-ios cannot read the battery: %s', err.message)
        })
    }

    function manageDeviceInfo() {
      return new Promise<void>(function(resolve) {
          log.info('device.name: ' + options.deviceName)

          var solo = wireutil.makePrivateChannel()
          var osName = 'iOS'
          var deviceName = options.deviceName.toLowerCase()

          if (deviceName.includes('tv')) {
            osName = 'tvOS'
          }

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.InitializeIosDeviceState(
              options.serial
            , wireutil.toDeviceStatus('device')
            , new wire.ProviderIosMessage(
                solo
              , options.provider
              , options.screenWsUrlPattern || ''
              )
            , new wire.IosDevicePorts(
                options.screenPort
              , options.connectPort
              )
            , new wire.UpdateIosDevice(
                options.serial
              , options.deviceName
              , osName
                // the build of iOS from sendLockdownInfo
              , ''
              )
            ))
          ])

          sendLockdownInfo().then(sendBattery)
          if (!batteryTimer) {
            batteryTimer = setInterval(sendBattery, BATTERY_INTERVAL)
            batteryTimer.unref()
          }

          resolve()
        })
        .catch(function(err) {
          log.error(err, 'Failed to manage device info')
        })
    }

    return {
      manageDeviceInfo: manageDeviceInfo
    }
  })
