var stream = require('stream')
var url = require('url')
var util = require('util')

var syrup = require('stf-syrup')
var request = require('request')
var Promise = require('bluebird')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var promiseutil = require('../../../util/promiseutil')
var spawn = require('child_process').spawn
var regExp = /([0-9]{1,3}%)/i

function InstallationError(err) {
  return err.code && /^INSTALL_/.test(err.code)
}

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
