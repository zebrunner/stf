const Promise = require('bluebird')
const { spawn } = require('child_process')
const wire = require('../wire/')
const wireUtil = require('../wire/util')
const wirerouter = require('../wire/router')
const zmqutil = require('./zmqutil')
const events = require('events')
const _ = require('lodash')
const logger = require('./logger')
const srv = require('./srv')
const lifecycle = require('./lifecycle')
const regExp = /([0-9a-zA-Z]{10,1000}).*'([\w ]+)'/i

module.exports = function(options) {
  const log = logger.createLogger('ios-usb')
  const push = zmqutil.socket('push')
  const solo = wireUtil.makePrivateChannel()
  const iosusb = new events.EventEmitter()
  let devices = {
    waiting: [],
    ready: []
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

  // push.send([
  //   wireUtil.global,
  //   wireUtil.envelope(new wire.DeleteDisconnectedDevices())
  // ])

  // setInterval(() => {
  //   push.send([
  //     wireUtil.global,
  //     wireUtil.envelope(new wire.DeleteDisconnectedDevices())
  //   ])
  // }, 60 * 1000)

  setInterval(()=> {
      const ls = spawn('ios-deploy', ['-c'])
      ls.stdout.on('data', (data) => {
        let str = data.toString()
        let deviceData = str.match(regExp)
        if(deviceData !== 'undefiend' && deviceData !== null) {
          const device = {
            id: deviceData[1],
            name: deviceData[2]
          }
          log.important(devices)
          // if(devices.waiting.find(item => item.id === device.id) === undefined) {
          //   devices.waiting.push(device)
            log.info(devices)
            push.send([
              wireUtil.global,
              wireUtil.envelope(new wire.CheckIosDeviceConnected(
                device.id,
                solo
              ))
            ])
          // }
        }
      })
      ls.stderr.on('data', (data) => {
        let str = data.toString()
        log.info('output :', str.match(regExp))
      })
      ls.on('close', (code) => {
        log.info(`child process exited with code ${code}`)
      })
  },30 * 1000)

  sub.on('message', wirerouter()
    .on(wire.ConnectDeviceViaUSB, function(channel, message) {
      log.info(`ios-use execud xcodebuid ${message.id}`)

      /*
      xcodebuild -project
      WebDriverAgent.xcodeproj
      -scheme WebDriverAgentRunner
      -destination
      "platform=iOS,
      id=6775adad13570022147ce70b6e24d709f90a0ffb" test
       */

      let args = [
        '-project', '/Users/macbook/Documents/"Qa Tools"/appium_WDA/WebDriverAgent.xcodeproj',
        '-scheme', 'WebDriverAgentRunner',
        '-destination', `"platform=iOS,id=${message.id}" UDID_STRING=${message.id}`,
        'test'
      ]
      let xcodebuild = spawn('xcodebuild', args, {
        shell: true
      })
      xcodebuild.stdout.on('data', (data) => {
        // @TODO add handler
        log.important(`stderr: ${data}`)
      })

      xcodebuild.stderr.on('data', (data) => {
        // @TODO add handler
        log.important(`stderr: ${data}`)
        // log.info('on xcodebuild error : ', devices)
      })

      xcodebuild.on('close', (code) => {
        iosusb.emit('remove', message)
        xcodebuild.kill('SIGHUP')
        log.fatal(`child process exited with code ${code}`)
        _.remove(devices.waiting, function(value) {
          if(value.id === message.id) {
            return value
          }
        })
        log.important(devices)
      })
      iosusb.emit('addDevice', message.id)
    })
    .handler())
  return iosusb
}
