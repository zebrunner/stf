import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {IosDeviceOptions, Push, Router, WdaClientPlugin} from '../../../types/ios-device.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import wdaClientSyrup from './wda/WdaClient.js'
import SettingsAutomation, {isSettingsPage, type IosRadio} from './wda/settings.js'
import {wdaErrorMessage} from './wda/automation.js'
import {connectedByUsb, execGoIos} from './util/goios.js'

type Channel = string | Buffer

// Wi-Fi and Bluetooth of the Device Settings card, switched in the Settings app through WDA
// (wda/settings.ts), and the pages of Settings the Apps card opens. Wi-Fi is turned off only on a device connected by USB, a device reached over
// the network (WIRELESS=true of mcloud-device) would be lost. The ringer mode and the bonded
// Bluetooth devices have no counterpart on iOS, their requests are refused instead of being left
// without an answer
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
    var log = logger.createLogger('device:plugins:radio')
    var settings = new SettingsAutomation({
      baseUrl: wdaClient.baseUrl
    , sessionId: function() {
        return wdaClient.sessionId
      }
    })

    function status(radio: IosRadio, enabled: boolean): string {
      return (radio === 'wifi' ? 'wifi_' : 'bluetooth_') + (enabled ? 'enabled' : 'disabled')
    }

    function supported(): boolean {
      return wdaClient.deviceType !== 'Apple TV'
    }

    function guard(radio: IosRadio, enabled: boolean): Promise<void> {
      if (radio !== 'wifi' || enabled) {
        return Promise.resolve()
      }
      return execGoIos(options.serial, ['list', '--details'], 15000)
        .catch(function() {
          return {stdout: ''}
        })
        .then(function(result) {
          if (!connectedByUsb(result.stdout, options.serial)) {
            throw new Error('Wi-Fi is turned off only on a device connected by USB')
          }
        })
    }

    function handle(channel: Channel, radio: IosRadio, enabled: boolean | null) {
      var reply = wireutil.reply(options.serial)
      if (!supported()) {
        push.send([channel, reply.fail('Not supported on tvOS')])
        return
      }

      log.info(enabled === null ?
        'Getting the state of %s' :
        'Turning %s ' + (enabled ? 'on' : 'off'), radio)
      var operation = enabled === null ?
        settings.isEnabled(radio) :
        guard(radio, enabled).then(function() {
          return settings.setEnabled(radio, enabled)
        })

      operation
        .then(function(state) {
          push.send([channel, reply.okay(status(radio, state))])
        })
        .catch(function(err) {
          log.error('Switching %s failed', radio, err.stack)
          push.send([channel, reply.fail(wdaErrorMessage(err))])
        })
    }

    function unsupported(channel: Channel) {
      push.send([channel, wireutil.reply(options.serial).fail('Not supported on iOS')])
    }

    router
      .on(wire.WifiGetStatusMessage, function(channel) {
        handle(channel, 'wifi', null)
      })
      .on(wire.WifiSetEnabledMessage, function(channel, message) {
        handle(channel, 'wifi', message.enabled)
      })
      .on(wire.BluetoothGetStatusMessage, function(channel) {
        handle(channel, 'bluetooth', null)
      })
      .on(wire.BluetoothSetEnabledMessage, function(channel, message) {
        handle(channel, 'bluetooth', message.enabled)
      })
      // Settings with a page: the shortcuts of the Apps card (Settings itself is opened by wda.ts)
      .on(wire.DashboardOpenMessage, function(_channel, message) {
        var page = message.page
        if (!page || !supported()) {
          return
        }
        if (!isSettingsPage(page)) {
          log.warn('Unknown page of Settings "%s"', page)
          return
        }
        log.info('Opening the %s page of Settings', page)
        settings.openPage(page).catch(function(err) {
          log.error('Opening the %s page of Settings failed', page, err.stack)
        })
      })
      .on(wire.BluetoothCleanBondedMessage, unsupported)
      .on(wire.RingerGetMessage, unsupported)
      .on(wire.RingerSetMessage, unsupported)
  })
