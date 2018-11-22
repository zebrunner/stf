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
  .dependency(require('./group'))
  // .dependency(require('../support/devdealer'))
  .define(function(options, push, router, sub, group) {
    var log = logger.createLogger('devicelog')
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
        var Logger = this
        Logger.channel = channel
        log.info('startLogging')
        if (
          deviceData &&
          deviceData !== null &&
          deviceData.bundleName.length !== 0 &&
          deviceData.bundleName.substr(-4) === '.app'
        ) {
          group.get().then(group => {
            launchArgs.push(deviceData.bundleName)
            Logger.stream = spawn('ios-deploy', launchArgs, {
              shell: true,
              cwd: deviceData.pathToApp
            })

            Logger.stream.stdout.on('data', data => {
              push.send([
                group.group,
                wireutil.envelope(
                  new wire.DeviceLogcatEntryMessage(
                    options.serial,
                    new Date().getTime() / 1000,
                    this.stream.pid,
                    this.stream.pid,
                    1,
                    'device:log:cat',
                    data.toString()
                  )
                )
              ])
            })

            Logger.stream.on('close', err => {
              //@TODO add handler fow closing event
              // Logger.killLoggingProcess()
            })
          })
        }
      },
      killLoggingProcess: () => {
        if(this.stream) {
          process.kill(-this.stream.pid)
          this.stream.kill()
          this.stream = null
          this.channel = ''
        }
      }
    }
    group.on('join', function() {
      // push.send([
      //   wireutil.global,
      //   wireutil.envelope(new wire.GetInstalledApplications(
      //     options.serial
      //   ))
      // ])
      // dbapi.getInstalledApplications({serial: options.serial})
      //   .then(applications => {
      //     push.send([
      //       wireutil.global,
      //       wireutil.envelope(new wire.DeviceAbsentMessage(
      //         JSON.stringify(applications)
      //       ))
      //     ])
      //   })
      //   .catch(err => {
      //     log.error(`Failed to get installed applications with error ${err}`)
      //   })
    })

    group.on('leave', DeviceLogger.killLoggingProcess)

    router
      .on(wire.LogcatStartMessage, function(channel, data) {
        var reply = wireutil.reply(options.serial)
        dbapi.loadDevice(options.serial).then(data => {
          DeviceLogger.startLoggging(channel, data.installedApps[0])
        })
        push.send([channel, reply.okay('success')])
      })
      .on(wire.LogcatStopMessage, function(channel, data) {
        DeviceLogger.killLoggingProcess()
      })
      .on(wire.GroupMessage, function(channel, data) {
        DeviceLogger.channel = channel
      })


    return Promise.resolve()
  })
