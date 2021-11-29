const Promise = require('bluebird')
const {spawn} = require('child_process')
const wire = require('../wire/')
const wireUtil = require('../wire/util')
const wirerouter = require('../wire/router')
const zmqutil = require('./zmqutil')
const {EventEmitter} = require('events')
const logger = require('./logger')
const srv = require('./srv')
const lifecycle = require('./lifecycle')
const regExp = /([0-9a-zA-Z]{10,1000}).*?\((.*)\).*'([\w ’'"`]+)'/i

module.exports = function(options) {
  const log = logger.createLogger('ios-usb')
  const push = zmqutil.socket('push')
  const solo = wireUtil.makePrivateChannel()
  const iosusb = new EventEmitter()

  //TODO: read later values from args!
  const device = {
    id: "d6afc6b3a65584ca0813eb8957c6479b9b6ebb11",
    name: "iPhone8Plus",
    platform: "iOS",
    architect: "arm64"
  }


  Promise.map(options.endpoints.push, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('ios provider sending output to "%s"', record.url)
        push.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
    .catch(function(err) {
      log.fata('Unable to connect to push endpoints', err)
    })

  const sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
    .catch(function(err) {
      log.fatal('Unable to connect to sub endpoint', err)
      lifecycle.fatal()
    })

  ;[solo].forEach(function(channel) {
    sub.subscribe(channel)
  })

  sub.on('message', wirerouter()
    .on(wire.ConnectDeviceViaUSB, function(channel, message) {
      const privatTracker = new EventEmitter()
      iosusb.emit('addDevice', message.id)

      function deviceListener(type, data) {
        privatTracker.emit(type, data)
      }

      iosusb.on(message.id, deviceListener)

      privatTracker.on('addDevice', msg => {
          push.send([
            wireUtil.global,
            wireUtil.envelope(new wire.UpdateIosDevice(
              device.id,
              device.name,
              device.platform,
              device.architect
            ))
          ])
      })
    })
    .handler())
  return iosusb
}
