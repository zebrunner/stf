var syrup = require('stf-syrup')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, router, push) {
    var log = logger.createLogger('device:plugins:install')
    var reply = wireutil.reply(options.serial)

    router.on(wire.InstallMessage, function(channel, message) {
      log.info(message)

      function sendProgress(data, progress) {
        push.send([
          channel,
          reply.progress(data, progress)
        ])
      }
    })
    router.on(wire.UninstallIosMessage, function(channel, message) {
      log.info('UnistallIosMessage, channel', channel)
      log.info('UnistallIosMessage, message', message)
      var args = [
        '--id', options.serial,
        ''
      ]
    })
})
