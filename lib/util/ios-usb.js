const Promise = require('bluebird')
const { spawn } = require('child_process')
const wire = require('../wire/')
const wireUtil = require('../wire/util')
const wirerouter = require('../wire/router')
const zmqutil = require('./zmqutil')
const logger = require('./logger')
const srv = require('./srv')
const lifecycle = require('./lifecycle')
const regExp = /([0-9a-zA-Z]{10,1000}).*'([\w ]+)'/i

module.exports = function(options) {
  const log = logger.createLogger('ios-usb')
  const push = zmqutil.socket('push')
  const solo = wireUtil.makePrivateChannel()

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

  push.send([
    wireUtil.global,
    wireUtil.envelope(new wire.DeleteDisconnectedDevices())
  ])

  setInterval(()=> {
      const ls = spawn('ios-deploy', ['-c'])

      ls.stdout.on('data', (data) => {
        let str = data.toString()
        let deviceData = str.match(regExp)
        log.info('deviceData', deviceData)
        if( deviceData !== 'undefiend' && deviceData !== null) {
          const device = {
            id: deviceData[1],
            name: deviceData[2]
          }
          push.send([
            wireUtil.global,
            wireUtil.envelope(new wire.CheckIosDeviceConnected(
              device.id,
              solo
            ))
          ])
        }
      })
      ls.stderr.on('data', (data) => {
        let str = data.toString()
        log.info('output :', str.match(regExp))
      })
      ls.on('close', (code) => {
        log.info(`child process exited with code ${code}`)
      })
  }, 30000)

  sub.on('message', wirerouter()
    .on(wire.ConnectDeviceViaUSB, function(channel, message) {
      log.info(`ios-use execud xcodebuid ${message.id}`)
      const {exec} = require('child_process')
      const shell = require('shelljs')
      const child = exec(`xcodebuild test -workspace ~/Documents/Projects/"Qa Tools"/WebDriverAgent/WebDriverAgent.xcworkspace  -scheme WebDriverAgentRunner -destination "platform=iOS,id=${message.id}"`, {maxBuffer: 200 * 1024}, (error, stdout, stderr) => {
        if (error) {
          log.fatal(`exec error: ${error}`)
          return
        }
        log.info(`stdout: ${stdout}`)
        log.info(`stderr: ${stderr}`)
      });
    })
    .handler())
}
