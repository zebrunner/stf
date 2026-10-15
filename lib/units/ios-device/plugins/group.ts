import events from 'events'

import Promise from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import grouputil from '../../../util/grouputil.js'
import lifecycle from '../../../util/lifecycle.js'
import dbapi from '../../../db/api.js'
import request from './util/rp.js'
import iosutil from './util/iosutil.js'
import activeOrNewSession from './wda/session.js'
import type {
  IosDeviceOptions
, IosGroupPlugin
, IosSoloPlugin
, Push
, Router
, Sub
, Channels
, WdaBatteryInfo
, WdaScreenInfo
, WdaValueResponse
, WdaWindowSize
} from '../../../types/ios-device.js'
import type {DeviceDocument} from '../../../types/stf.js'
import type {OwnerMessage} from '../../../types/wire.js'
import soloSyrup from './solo.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import subSyrup from '../support/sub.js'
import channelsSyrup from '../support/channels.js'

type Log = ReturnType<typeof logger.createLogger>

interface WdaDeviceInfo {
  model: string
  name: string
}

function missingFirstSessionData(device: DeviceDocument | null): boolean {
  return !device?.display?.width || !device.display.height || !device.deviceType
}

function storeDeviceSize(
  options: IosDeviceOptions
, baseUrl: string
, sessionId: string
, log: Log
) {
  return request<WdaValueResponse<WdaWindowSize>>({
    method: 'GET'
  , uri: `${baseUrl}/session/${sessionId}/window/size`
  , json: true
  }).then(function(firstSessionSize) {
    var width = firstSessionSize.value.width
    var height = firstSessionSize.value.height

    return request<string>({
      method: 'GET'
    , uri: `${baseUrl}/session/${sessionId}/wda/screen`
    }).then(function(scaleResponse) {
      var parsedResponse = JSON.parse(scaleResponse) as WdaValueResponse<WdaScreenInfo>
      var scale = parsedResponse.value.scale

      height *= scale
      width *= scale

      log.info('Storing device size/scale')

      return dbapi.sizeIosDevice(options.serial, height, width, scale)
    })
  })
}

export default syrup.serial()
  .dependency(soloSyrup)
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(subSyrup)
  .dependency(channelsSyrup)
  .define(function(
    options: IosDeviceOptions
  , solo: IosSoloPlugin
  , router: Router
  , push: Push
  , sub: Sub
  , channels: Channels
  ): IosGroupPlugin {
    var log = logger.createLogger('device:plugins:group')
    var baseUrl = iosutil.getUri(options.wdaHost, options.wdaPort)
    var currentGroup: OwnerMessage | null = null
    var plugin = new events.EventEmitter() as IosGroupPlugin

    plugin.get = Promise.method(function() {
      if (!currentGroup) {
        throw new grouputil.NoGroupError()
      }
      return currentGroup
    })

    plugin.join = function(newGroup: OwnerMessage, timeout, usage) {
      return plugin.get()
        .then(function() {
          if (currentGroup!.group !== newGroup.group) {
            throw new grouputil.AlreadyGroupedError()
          }
          return currentGroup!
        })
        .catch(grouputil.NoGroupError, function() {
          currentGroup = newGroup

          log.important('Now owned by "%s"', currentGroup.email)
          log.info('Subscribing to group channel "%s"', currentGroup.group)

          channels.register(currentGroup.group, {
            timeout: timeout || options.groupTimeout
          , alias: solo.channel
          })

          sub.subscribe(currentGroup.group)

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.JoinGroupMessage(
              options.serial
            , currentGroup
            , usage
            ))
          ])

          dbapi.loadDeviceBySerial(options.serial).then(function(device) {
            if (!missingFirstSessionData(device)) {
              return
            }

            var deviceType: string | undefined
            request<WdaValueResponse<WdaDeviceInfo>>({
              method: 'GET'
            , uri: `${baseUrl}/wda/device/info`
            , json: true
            })
              .then(function(deviceInfo) {
                var deviceInfoModel = deviceInfo.value.model.toLowerCase()
                var deviceInfoName = deviceInfo.value.name.toLowerCase()
                if (deviceInfoModel.includes('tv') || deviceInfoName.includes('tv')) {
                  deviceType = 'Apple TV'
                }
                else {
                  deviceType = 'iPhone'
                }
                log.info('Storing device type value: ' + deviceType)
                return dbapi.setDeviceType(options.serial, deviceType)
              })
              .catch(function(err) {
                log.error('Error storing device type')
                lifecycle.fatal(err)
              })

            activeOrNewSession(baseUrl, request)
              .then(function(session) {
                var sessionResponse = session.response
                var sessionId = sessionResponse.sessionId

                log.info('Storing device version')
                push.send([
                  wireutil.global
                , wireutil.envelope(new wire.SdkIosVersion(
                    options.serial
                  , sessionResponse.value.capabilities.device
                  , sessionResponse.value.capabilities.sdkVersion
                  ))
                ])

                if (deviceType !== 'Apple TV') {
                  request<WdaValueResponse<WdaBatteryInfo>>({
                    method: 'GET'
                  , uri: `${baseUrl}/session/${sessionId}/wda/batteryInfo`
                  , json: true
                  })
                    .then(function(batteryInfoResponse) {
                      var batteryState = iosutil.batteryState(batteryInfoResponse.value.state)
                      var batteryLevel = iosutil.batteryLevel(batteryInfoResponse.value.level)

                      push.send([
                        wireutil.global
                      , wireutil.envelope(new wire.BatteryIosEvent(
                          options.serial
                        , 'good'
                        , 'usb'
                        , batteryState
                        , batteryLevel
                        , 'n/a'
                        , 100
                        ))
                      ])
                    })
                    .catch(function(err) {
                      log.error('Error storing battery', err)
                    })
                }

                return storeDeviceSize(options, baseUrl, sessionId, log)
              })
              .catch(function(err) {
                log.error('Error storing device size/scale')
                lifecycle.fatal(err)
              })
          })

          plugin.emit('join', currentGroup)

          return currentGroup
        })
    }

    plugin.keepalive = function() {
      if (currentGroup) {
        channels.keepalive(currentGroup.group)
      }
    }

    plugin.leave = function(reason) {
      return plugin.get()
        .then(function(group) {
          log.important('No longer owned by "%s"', group.email)
          log.info('Unsubscribing from group channel "%s"', group.group)

          channels.unregister(group.group)
          sub.unsubscribe(group.group)

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.LeaveGroupMessage(
              options.serial
            , group
            , reason
            ))
          ])

          currentGroup = null
          plugin.emit('leave', group)

          return group
        })
    }

    router
      .on(wire.GroupMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        Promise.method(function() {
          return plugin.join(message.owner, message.timeout, message.usage)
        })()
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
          })
          .catch(grouputil.RequirementMismatchError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
          .catch(grouputil.AlreadyGroupedError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })
      .on(wire.AutoGroupMessage, function(_channel, message) {
        return plugin.join(message.owner, null, message.identifier)
          .then(function() {
            plugin.emit('autojoin', message.identifier, true)
          })
          .catch(grouputil.AlreadyGroupedError, function() {
            plugin.emit('autojoin', message.identifier, false)
          })
      })
      .on(wire.UngroupMessage, function(channel) {
        var reply = wireutil.reply(options.serial)
        Promise.method(function() {
          return plugin.leave('ungroup_request')
        })()
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
          })
          .catch(grouputil.NoGroupError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })

    channels.on('timeout', function(channel) {
      if (currentGroup && channel === currentGroup.group) {
        plugin.leave('automatic_timeout')
      }
    })

    lifecycle.observe(function() {
      return plugin.leave('device_absent')
        .catch(grouputil.NoGroupError, function() {
          return true
        })
    })

    return plugin
  })
