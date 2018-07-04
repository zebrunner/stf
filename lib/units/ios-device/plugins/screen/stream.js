var util = require('util')
var syrup = require('stf-syrup')
var uuid = require('uuid')
var WebSocketServer = require('ws')
var Promise = require('bluebird')
var app = require('express')()
var wire = require('../../../../wire')
var wirerouter = require('../../../../wire/router')
var wireutil = require('../../../../wire/util')
var http = require('http').Server(app)
var io = require('socket.io')(http)

var logger = require('../../../../util/logger')
var lifecycle = require('../../../../util/lifecycle')

var client = {}
var sessionId
const USER = 'user'

module.exports = syrup.serial()
  .dependency(require('./options'))
  .dependency(require('../../support/push'))
  .dependency(require('../../support/sub'))
  .define(function(options, push, sub) {
    var log = logger.createLogger('device:plugins:screen:stream')

    log.info('webSocket options.screenPort', options.screenPort)
    log.info('Starting WebSocket server on port ', options)
    log.info('plugin start , connect port', options.connectPort)
    var webSocketServer = new WebSocketServer.Server({
        port: options.screenPort
    })
    // sockets for receiving binary img to client(stream)
    webSocketServer.on('connection', function(ws) {
      client[USER] = ws
      log.info('connected123 !!!!!!')
      ws.on('close', function() {
        delete client[USER]
      })
      ws.on('error', function() {
        delete client[USER]
      })
    })

    log.info('ios-device output options ', options)
    io.on('connection', function(socket) {
      sub.on('message', wirerouter()
        .on(wire.TouchDownIosMessage, function(channel, message) {
          log.info(' TouchDownMessage ~~~~~~~~~~`', message)
          log.info('device channel --->', options)
          message.path = `/session/${sessionId}/wda/tap/0`
          socket.emit('touchDown', JSON.stringify(message))
        })
        .on(wire.TouchMoveIosMessage, function(channel, message) {
          log.info(' TouchDownMessage ~~~~~~~~~~`', message)
          log.info('device channel --->', options)
          message.path = `/session/${sessionId}/wda/element/0/dragfromtoforduration`
          socket.emit('swipe', JSON.stringify(message))
        })
        .handler())
      socket.on('chat message', function(msg) {
        io.emit('chat message', msg)
      })
      socket.on('connectIos', function(msg) {
        log.info('device sessionId', msg)
        sessionId = msg
      })
      socket.on('sendImg', function(msg) {
        if(client[USER]) {
            client[USER].send(msg)
        }
        log.info(options.connectPort, msg)
      })
    })
    // push.send([
    //   wireutil.global
    //   , wireutil.envelope(new wire.TestPush(
    //    'some action'
    //   ))
    // ])
    http.listen(options.connectPort, function() {
      log.info('listening on *:' + options.connectPort)
    })
  })
