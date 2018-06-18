var syrup = require('stf-syrup')
var WebSocketServer = require('ws')
var Promise = require('bluebird')
var app = require('express')();
var wire = require('../../wire')
var wirerouter = require('../../wire/router')
var wireutil = require('../../wire/util')
var http = require('http').Server(app);
var io = require('socket.io')(http);
var logger = require('../../util/logger')
var lifecycle = require('../../util/lifecycle')
var client = {}
var sessionId
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
        //.dependency(require('./plugins/connect'))
        .dependency(require('./plugins/solo'))
        .dependency(require('./support/push'))
        .dependency(require('./support/sub'))
        .define(function(options, heatbeat, solo, push, sub) {
          log.info('webSocket options.screenPort', options.screenPort)
          log.info('Starting WebSocket server on port ', options)
          log.info('plugin start , connect port', options.connectPort)
          var webSocketServer = new WebSocketServer.Server({
              port: options.screenPort
          })
          // sockets for receiving binary img to client(stream)
          webSocketServer.on('connection', function(ws) {
            client['user'] = ws
            log.info('connected123 !!!!!!')
            ws.on('close', function() {
              delete client['user']
            })
            ws.on('error', function() {
              delete client['user']
            })
          })
          // connect ios-client
          // var webSocketIosClient = new WebSocketServer.Server({
          //   port: options.connectPort
          // })
          // webSocketIosClient.on('connection', function(ws) {
          //   ws.on('message', function(msg) {
          //     log.info('ios-client', msg)
          //   })
          //   ws.on('close', function() {
          //    log.info('ios-client sockets closed')
          //   })
          //   ws.on('error', function() {
          //     log.info('ios-client socktes interupted!')
          //   })
          // })

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
              io.emit('chat message', msg);
            })
            socket.on('connectIos', function(msg) {
              log.info('device sessionId', msg)
              sessionId = msg
            })
            socket.on('sendImg',function(msg) {
              if(client['user']) {
                  client['user'].send(msg)
              }
              log.info(options.connectPort,msg)
            })
          })
          push.send([
            wireutil.global
            , wireutil.envelope(new wire.TestPush(
             'some action'
            ))
          ])
          http.listen(options.connectPort, function(){
            log.info('listening on *:' + options.connectPort);
          })

          log.info('solo :', solo)
            return solo.poke()
          })

        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      log.fatal('Setup had an error', err.stack)
      lifecycle.fatal()
    })
}
