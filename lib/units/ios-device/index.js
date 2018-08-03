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
var asciiParser = require('../../util/asciiparser')
var logger = require('../../util/logger')
var lifecycle = require('../../util/lifecycle')
var client = {}
var sessionId
var USER = 'user'
module.exports = function(options) {
  // Show serial number in logs
  logger.setGlobalIdentifier('emulator-5554')

  var log = logger.createLogger('device')

  return syrup.serial()
  // We want to send logs before anything else starts happening
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
      //  .dependency(require('./plugins/connect'))
        .define(function(options, heatbeat, solo, push, sub, group) {
          const promises = []
          let ready = false

          // @todo refactor ios-device , split to modules and add promises !!!awdadadad
          log.info('webSocket options.screenPort', options.screenPort)
          log.info('Starting WebSocket server on port ', options)
          log.info('plugin start , connect port', options.connectPort)
          // var webSocketServer = new WebSocketServer.Server({
          //   port: options.screenPort
          // })
          promises.push(new Promise(function(resolve, reject) {
            var webSocketServer = new webSocket.Server({
              port: options.screenPort
            })

            webSocketServer.on('connection', function(ws) {
              client[USER] = ws

              ws.on('close', function() {
                delete client[USER]
              })

              ws.on('error', function() {
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
                .on(wire.TypeMessage, function(channel, message) {
                  message.path = `session/${sessionId}/wda/keys`
                  message.value = [asciiParser(message.text)]
                  socket.emit('keyPress', JSON.stringify(message))
                })
                .on(wire.TouchMoveIosMessage, function(channel, message) {
                  message.path = `/session/${sessionId}/wda/element/0/dragfromtoforduration`
                  log.info('TouchMoveIosMessage message', message)
                  socket.emit('swipe', JSON.stringify(message))
                })
                .handler())
              socket.on('connectIos', function(message) {
                sessionId = message
              })

              socket.on('sendImg', function(message) {
                if(!ready) {
                  ready = true
                  log.info('resovle io!!!')
                  resolve()
                }
                if (client[USER]) {
                  client[USER].send(message)
                }
              })

              socket.on('error', function(error) {
                reject()
                end()
                log.info('connectPort error', error)
              })

              socket.on('disconnect', function() {
                log.info('device disconneced !')
                end()
                reject()
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
            log.info('device preapered !!! :', solo)
            return solo.poke()
          }).catch(function(err) {
            log.fatal('Setup had an error', err.stack)
            lifecycle.fatal()
          })
        })

        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      log.fatal('Setup had an error', err.stack)
      lifecycle.fatal()
    })
}
