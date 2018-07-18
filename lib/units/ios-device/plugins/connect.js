var util = require('util')
var webSocket = require('ws')
var syrup = require('stf-syrup')
var Promise = require('bluebird')
var http = require('http')
var io = require('socket.io')(http)

var logger = require('../../../util/logger')
var grouputil = require('../../../util/grouputil')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var wirerouter = require('../../../wire/router')
var lifecycle = require('../../../util/lifecycle')
var asciiParser = require('../../../util/asciiparser')
var USER = 'user'
var sessionId
var client = {}

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('./group'))
  .dependency(require('./solo'))
  .dependency(require('./util/urlformat'))
  .dependency(require('../support/sub'))
  .define(function(options, router, push, group, solo, urlformat, sub) {
    var log = logger.createLogger('device:plugins:connect')
    const promises = []
    var ready = false

    return function() {
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
          resolve()
        })
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
              message.value = [asciiParser(message.txt)]
              socket.emit('swipe', JSON.stringify(message))
            })
            .handler())
          socket.on('connectIos', function(message) {
            sessionId = message
          })

          socket.on('sendImg', function(message) {
            if(!ready) {
              ready = true
              resolve()
            }
            if (client[USER]) {
              client[USER].send(message)
            }
          })

          socket.on('error', function(error) {
            log.info('connectPort error', error)
          })
        })

        http.listen(options.connectPort, function() {
          log.info('listening on *:' + options.connectPort)
        })
      }))
      //return Promise.all(promises)
    }
  })

