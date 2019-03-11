var syrup = require('stf-syrup')
var Promise = require('bluebird')
var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var {exec} = require('child_process')

module.exports = syrup
  .serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, router, push) {
    var log = logger.createLogger('device:plugins:reboot')

    router.on(wire.RebootMessage, function(channel) {
      var reply = wireutil.reply(options.serial)
      exec(`idevicediagnostics -u ${options.serial} restart`, function(err, stdout, stderr) {
        // console.log(stdout)
      })
      Promise.delay(5000)
        .then(function() {
          push.send([channel, reply.okay()])
        })
        .error(function(err) {
          log.error('Reboot failed', err.stack)
          push.send([channel, reply.fail(err.message)])
        })
    })
  })
