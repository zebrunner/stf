var syrup = require('stf-syrup')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var wirerouter = require('../../../wire/router')
var spawn = require('child_process').spawn
var Promise = require('Bluebird')
var srv = require('../../../util/srv')
var lifecycle = require('../../../util/lifecycle')
var zmqutil = require('../../../util/zmqutil')
var dbapi = require('../../../db/api')

module.exports = syrup
  .serial()
  .dependency(require('../support/push'))
  .dependency(require('../support/router'))
  .dependency(require('../support/sub'))
  // .dependency(require('../support/devdealer'))
  .define(function(options, push, router, sub) {
    var log = logger.createLogger('devicelog')
    log.info('ios-device devicelog options :', options)
    var launchArgs = [
      '--id',
      options.serial,
      '--verbose',
      '--debug',
      '--noinstall',
      '--bundle'
    ]
    var DeviceLogger = {
      appOptions: {},
      channel: '',
      stream: null,
      setChannel: channel => {
        this.channel = channel
      },
      startLoggging: (channel, deviceData) => {
        this.channel = channel
        log.info('startLogging')
        if (
          deviceData &&
          deviceData !== null &&
          deviceData.bundleName.length !== 0 &&
          deviceData.bundleName.substr(-4) === '.app'
        ) {
          launchArgs.push(deviceData.bundleName)
          this.stream = spawn('ios-deploy', launchArgs, {
            shell: true,
            cwd: deviceData.pathToApp
          })

          this.stream.stdout.on('data', data => {
            log.info(`ios-device debug output : ${data}`)
            // push.send([
            //   channel,
            //   wireutil.envelope(
            //     new wire.DeviceLogcatEntryMessage(
            //       options.serial,
            //       Math.round(new Date().getTime() / 1000),
            //       this.stream.pid,
            //       this.stream.pid,
            //       3,
            //       'debug',
            //       data.toString()
            //     )
            //   )
            // ])
            push.send([
              channel,
              wireutil.envelope(
                new wire.DeviceLogMessage(
                  options.serial,
                  new Date().getTime() / 1000,
                  1,
                  'device:plugins:logcat',
                  this.stream.pid,
                  data.toString(),
                  options.serial
                )
              )
            ])
          })

          this.stream.on('close', err => {
            log.error(`Device[${options.serial}] debug stream was closed 
              with error ${err}`)
            this.killLoggingProcess()
          })
        }
      },
      killLoggingProcess: () => {
        this.stream.kill()
      }
    }

    router.on(wire.LogcatStartMessage, function(channel, data) {
      var reply = wireutil.reply(options.serial)
      dbapi.loadDevice(options.serial).then(data => {
        DeviceLogger.startLoggging(channel, data)
      })
      push.send([channel, reply.okay('success')])
    })

    return Promise.resolve()
  })
