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
let readyDevices = {}
const iosutil = require('./iosutil')

module.exports = function(options) {
  const log = logger.createLogger('ios-usb')
  const push = zmqutil.socket('push')
  const solo = wireUtil.makePrivateChannel()
  const iosusb = new EventEmitter()

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

  setInterval(()=> {
      const ls = spawn('ios-deploy', ['-c']) // finds all connected devices
      ls.stdout.on('data', (data) => {
        let str = data.toString()
//        log.important('data: ', data)
        let deviceData = str.match(regExp)
//        log.important("deviceData: ", deviceData)
        if(deviceData !== 'undefiend' && deviceData !== null) {
        let info = deviceData[2].split(', ')
        if(iosutil.checkDevice(options, deviceData[1], log)) { // check if device find in local/user file
          const device = {
            id: deviceData[1],
            name: deviceData[3],
            platform: info[2],
            architect: info[3]
          }
          
            push.send([
              wireUtil.global,
              wireUtil.envelope(new wire.CheckIosDeviceConnected(
                device.id,
                solo
              ))
            ])
            readyDevices[device.id] = {
              id: device.id,
              name: device.name,
              platform: device.platform,
              architect: device.architect
            }
        }
        }
      })
      ls.stderr.on('data', (data) => {
        let str = data.toString()
        log.info('output :', str.match(regExp))
      })
      ls.on('close', (code) => {
        log.info(`child process exited with code ${code}`)
      })
  }, 30 * 1000)

  sub.on('message', wirerouter()
    .on(wire.ConnectDeviceViaUSB, function(channel, message) {
      log.info(`ios-use execud xcodebuid ${message.id}`)
      const privatTracker = new EventEmitter()
      iosusb.emit('addDevice', message.id)

      function deviceListener(type, data) {
        privatTracker.emit(type, data)
      }

      iosusb.on(message.id, deviceListener)

      privatTracker.on('startWdaOnPorts', msg => {
//        log.important('startWdaOnPorts', msg)
        if (readyDevices[message.id]) {
          push.send([
            wireUtil.global,
            wireUtil.envelope(new wire.UpdateIosDevice(
              readyDevices[message.id].id,
              readyDevices[message.id].name,
              readyDevices[message.id].platform,
              readyDevices[message.id].architect
            ))
          ])
          delete readyDevices[message.id]
        }
        const {connectPort} = msg
        let args = [
          '-project', options.wdaPath,
          '-scheme', 'WebDriverAgentRunner',
          '-destination', `"platform=iOS,id=${message.id}" USE_PORT=${msg.wdaPort} UDID_STRING=${message.id} MJPEG_SERVER_PORT=${connectPort}`,
          'test'
        ]
//	log.important('args: ', args)
//        let xcodebuild = spawn('xcodebuild', args, {
//          shell: true
//        })
//        xcodebuild.stdout.on('data', (data) => {
//          // @TODO add handler
//          log.important(data.toString())
//        })

//        xcodebuild.stderr.on('data', (data) => {
//          // @TODO add handler
//          log.important('ERROR!!!', data.toString())
//        })

//        xcodebuild.on('close', (code) => {
//          iosusb.emit('remove', message)
//          xcodebuild.kill('SIGHUP')
//          iosusb.removeListener(message.id, deviceListener)
//          log.fatal(`xcodebuild child process exited with code ${code}`)
//        })
      })
    })
    .handler())
  return iosusb
}
