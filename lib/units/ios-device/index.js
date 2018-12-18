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
        .dependency(require('./plugins/wda'))
        .dependency(require('./plugins/screen/stream'))
        .dependency(require('./plugins/reaper'))
        .define(function(options, heatbeat, solo, push, sub,
         storage, devicelog, stream, wda, reaper) {
          if (process.send) {
            // Only if we have a parent process
            process.send('ready')
          }
          log.info('Fully operational')
          wda.connect()
            .then(() => solo.poke())
            .catch(() => lifecycle.fatal())
        })
        .consume(options)
    })
    .consume(options)
    .catch(function(err) {
      lifecycle.fatal()
    })
}
