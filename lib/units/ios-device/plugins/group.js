const events = require('events')
const Promise = require('bluebird')
const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const grouputil = require('../../../util/grouputil')
const lifecycle = require('../../../util/lifecycle')
const dbapi = require('../../../db/api')
const request = require('request-promise')
const iosutil = require('./util/iosutil')

module.exports = syrup.serial()
  .dependency(require('./solo'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../support/sub'))
  .dependency(require('../support/channels'))
  .define((options, solo, router, push, sub, channels) => {
    const log = logger.createLogger('device:plugins:group')
    const baseUrl = iosutil.getUri(options.wdaHost, options.wdaPort)
    let currentGroup = null
    let plugin = new events.EventEmitter()

    plugin.get = Promise.method(() => {
      if (!currentGroup) {
        throw new grouputil.NoGroupError()
      }
      return currentGroup
    })

    plugin.join = (newGroup, timeout, usage) => {
      return plugin.get()
        .then(() => {
          if (currentGroup.group !== newGroup.group) {
            throw new grouputil.AlreadyGroupedError()
          }
          return currentGroup
        })
        .catch(grouputil.NoGroupError, () => {
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

          const handleRequest = (reqOptions) => {
            return new Promise((resolve, reject) => {
              request(reqOptions)
                .then((res) => {
                  resolve(res)
                })
                .catch((err) => {
                  reject(err)
                })
            })
          }

          dbapi.loadDeviceBySerial(options.serial).then((device) => {
            // No device version = First device session 
            if (!device.version) {
              // Get device type
              handleRequest({
                method: 'GET',
                uri: `${baseUrl}/wda/device/info`,
                json: true
              })
                .then((deviceInfo) => {
                  let deviceInfoModel = deviceInfo.value.model.toLowerCase()
                  let deviceInfoName = deviceInfo.value.name.toLowerCase()
                  let deviceType
                  if (deviceInfoModel.includes("tv") || deviceInfoName.includes("tv")) {
                    deviceType = "Apple TV"
                  } else {
                    deviceType = "iPhone"
                  }
                  log.info('Storing device type value: ' + deviceType)
                  dbapi.setDeviceType(options.serial, deviceType)
                })
                .catch((err) => {
                  log.error('Error storing device type')
                  return lifecycle.fatal(err)
                })

              // Get device size
              handleRequest({
                method: 'POST',
                uri: `${baseUrl}/session`,
                body: { capabilities: {}},
                json: true,
              })
              .then((sessionResponse) => {
                let sessionId = sessionResponse.sessionId

                return handleRequest({
                  method: 'GET',
                  uri: `${baseUrl}/session/${sessionId}/window/size`,
                  json: true
                }).then((firstSessionSize) => {
                  let deviceSize = firstSessionSize.value
                  let { width, height } = deviceSize
                  return handleRequest({
                    method: 'GET',
                    uri: `${baseUrl}/session/${sessionId}/wda/screen`,
                  }).then((scaleResponse) => {
                    let parsedResponse = JSON.parse(scaleResponse)
                    let scale = parsedResponse.value.scale
      
                    height *= scale
                    width *= scale
      
                    log.info('Storing device size/scale')
      
                    dbapi.sizeIosDevice(options.serial, height, width, scale)
                  })
                })
              })
              .catch((err) => {
                log.error('Error storing device size/scale')
                return lifecycle.fatal(err)
              })
            }
          })

          plugin.emit('join', currentGroup)

          return currentGroup
        })
    }

    plugin.keepalive = () => {
      if (currentGroup) {
        channels.keepalive(currentGroup.group)
      }
    }

    plugin.leave = (reason) => {
      return plugin.get()
        .then(group => {
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

    // plugin.on('join', function() {
    //   service.wake()
    //   service.acquireWakeLock()
    // })

    // plugin.on('leave', function() {
    //   if (options.screenReset) {
    //     service.pressKey('home')
    //     service.thawRotation()
    //   }
    //   service.releaseWakeLock()
    // })

    router
      .on(wire.GroupMessage, (channel, message) => {
        let reply = wireutil.reply(options.serial)
        //grouputil.match(ident, message.requirements)
          Promise.method(() => {
            return plugin.join(message.owner, message.timeout, message.usage)
          })()
          .then(() =>{
            push.send([
              channel
              , reply.okay()
            ])
          })
          .catch(grouputil.RequirementMismatchError, (err) => {
            push.send([
              channel
              , reply.fail(err.message)
            ])
          })
          .catch(grouputil.AlreadyGroupedError, (err) => {
            push.send([
              channel
              , reply.fail(err.message)
            ])
          })
      })
      .on(wire.AutoGroupMessage, (channel, message) => {
        return plugin.join(message.owner, message.timeout, message.identifier)
          .then(() => {
            plugin.emit('autojoin', message.identifier, true)
          })
          .catch(grouputil.AlreadyGroupedError, () => {
            plugin.emit('autojoin', message.identifier, false)
          })
      })
      .on(wire.UngroupMessage, (channel, message) => {
        let reply = wireutil.reply(options.serial)
          Promise.method(() => {
            return plugin.leave('ungroup_request')
          })()
          .then(() => {
            push.send([
              channel
              , reply.okay()
            ])
          })
          .catch(grouputil.NoGroupError, err => {
            push.send([
              channel
              , reply.fail(err.message)
            ])
          })
      })

    channels.on('timeout', channel => {
      if (currentGroup && channel === currentGroup.group) {
        plugin.leave('automatic_timeout')
      }
    })

    lifecycle.observe(() => {
      return plugin.leave('device_absent')
        .catch(grouputil.NoGroupError, () => true)
    })

    return plugin
  })
