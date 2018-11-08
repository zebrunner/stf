var syrup = require('stf-syrup')
//var WebSocketServer = require('ws')
var webSocket = require('ws')
var Promise = require('bluebird')
var app = require('express')()
var wire = require('../../wire')
var wirerouter = require('../../wire/router')
var wireutil = require('../../wire/util')
var http = require('http').Server(app)
var io = require('socket.io')(http)
var fs = require('fs')
var url = require('url')
var util = require('util')
var iosutils = require('../../util/iosutil')
var logger = require('../../util/logger')
var lifecycle = require('../../util/lifecycle')
var request = require('request')
var client = {}
var sessionId
var USER = 'user'

  module.exports = function(options) {
  // Show serial number in logs
  logger.setGlobalIdentifier(options.serial)


    return syrup.serial()
    .dependency(require('./plugins/logger'))
    .define(function(options) {
      var log = logger.createLogger('device')
      log.info('Preparing device')
      return syrup.serial()
        .dependency(require('./plugins/heartbeat'))
        .dependency(require('./plugins/solo'))
        .dependency(require('./support/push'))
        .dependency(require('./support/sub'))
        .dependency(require('./plugins/group'))
        .dependency(require('./support/storage'))
        .dependency(require('./plugins/devicelog'))
        .define(function(options, heatbeat, solo, push, sub, group, storage, devicelog) {
          var log = logger.createLogger('device')
          const promises = []
          let ready = false
          promises.push(new Promise(function(resolve, reject) {
            var webSocketServer = new webSocket.Server({
              port: options.screenPort
            })

            webSocketServer.on('connection', function(ws) {
              client[USER] = ws
              ws.on('close', function(data) {
                log.error('Device has been disconnected')
                delete client[USER]
              })

              ws.on('error', function(data) {
                log.error('Device has been disconnected with error :', data)
                delete client[USER]
              })
            })
            resolve()
          }))

          promises.push(new Promise(function(resolve, reject) {
            io.on('connection', function(socket) {
              sub.on('message', wirerouter()
                .on(wire.TouchDownIosMessage, function(channel, message) {
                  message.path = `/session/${sessionId}/wda/tap/0`
                  socket.emit('touchDown', JSON.stringify(message))
                })
                .on(wire.RotateMessage, function(channel, message) {
                  socket.emit('getExtention')
                  socket.on('sendDeviceExtention', function(msg) {
                    var orientation = iosutils.degreesToOrientation(message.rotation)
                    var payload = {
                      path: `/session/${sessionId}/orientation`,
                      orientation: orientation
                    }
                    socket.emit('setRotation', JSON.stringify(payload))
                    push.send([
                      wireutil.global,
                      wireutil.envelope(new wire.RotationEvent(
                        options.serial,
                        message.rotation
                      ))
                    ])
                    log.info(message)
                    log.info(`Set device orientation to ${orientation}`)
                  })
                })
                .on(wire.ScreenCaptureMessage, function(channel, message) {
                  let reply = wireutil.reply(options.serial)
                  socket.emit('screenshotData', JSON.stringify(message))
                  socket.on('screenshotData', function(msg) {
                    var args = {
                      url: url.resolve(options.storageUrl, util.format('s/upload/%s', 'image'))
                    }
                    var req = request.post(args, function(err, res, body) {
                      try {
                        var result = JSON.parse(body)
                        push.send([
                          channel
                          , reply.okay('success', result.resources.file)
                        ])
                      }
                      catch (err) {
                        log.error('Invalid JSON in response', err.stack, body)
                      }
                    })
                    req.form()
                      .append('file', msg, {
                        filename: util.format('%s.jpg', options.serial),
                        contentType: 'image/jpeg'
                      })
                  })
                })
                .on(wire.KeyPressMessage, function(channel, message) {
                  message.path = '/wda/homescreen'
                  socket.emit('home', message)
                })
                .on(wire.BrowserOpenMessage, function(channel, message) {
                  log.info('message', message)
                  var payload = {
                    path: '/session',
                    desiredCapabilities: {
                      bundleId: 'com.apple.mobilesafari',
                      arguments: ['-u', message.url]
                    }
                  }
                  socket.emit('openUrl', JSON.stringify(payload))
                })
                .on(wire.TypeMessage, function(channel, message) {
                  message.path = `session/${sessionId}/wda/keys`
                  message.value = [iosutils.asciiparser(message.text)]
                  socket.emit('keyPress', JSON.stringify(message))
                })
                .on(wire.TouchMoveIosMessage, function(channel, message) {
                  message.path = `/session/${sessionId}/wda/element/0/dragfromtoforduration`
                  socket.emit('swipe', JSON.stringify(message))
                })
                .handler())
              socket.on('connectIos', function(message) {
                sessionId = message
                log.info('has been established sesssionId :', sessionId)
              })
              socket.on('sendImg', function(message) {
                if(!ready) {
                  ready = true
                  resolve()
                }
                if (client[USER]) {
                    client[USER].send(message)
                }
                if(message === 'undefined') {
                  end()
                  push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.DeleteIosDevice(
                      options.serial
                    ))
                  ])
                }
              })

              socket.on('error', function(error) {
                reject()
                end()
                push.send([
                  wireutil.global,
                  wireutil.envelope(new wire.DeleteIosDevice(
                    options.serial
                  ))
                ])
              })

              socket.on('disconnect', function() {
                log.info('Device has been disconnected')
                end()
                push.send([
                  wireutil.global,
                  wireutil.envelope(new wire.DeleteIosDevice(
                    options.serial
                  ))
                ])
              })
            })

            http.listen(options.connectPort, function() {
              log.info('listening on *:' + options.connectPort)
            })
          }))

          var end = function() {
            push.send([
              wireutil.global
              , wireutil.envelope(new wire.DeviceAbsentMessage(
                options.serial
              ))
            ])
            log.fatal('Setup had an error')
            lifecycle.fatal()
          }

          return Promise.all(promises)
            .then(function() {
              log.info('Device fully operational')
              return solo. poke()
            }).catch(function(err) {
              log.fatal('Setup had an error', err.stack)
              lifecycle.fatal()
            })
        })

        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      lifecycle.fatal()
    })
}
