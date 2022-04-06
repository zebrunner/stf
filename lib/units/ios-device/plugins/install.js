const stream = require('stream')
const url = require('url')
const syrup = require('@devicefarmer/stf-syrup')
const request = require('request')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, router, push) {
    const log = logger.createLogger('device:plugins:install')
    log.info("ios-device plugins init...")


    router.on(wire.InstallMessage, function(channel, message) {
      log.info('Installing application from "%s"', message.href)

      var reply = wireutil.reply(options.serial)

      function sendProgress(data, progress) {
        push.send([
          channel,
          reply.progress(data, progress)
        ])
      }

      var req = request({
        url: url.resolve(options.storageUrl, message.href)
      })


      //TODO: test that binary source is ipa/app/zip content
      var source = new stream.Readable().wrap(req)
      log.info("source: " + source)

      //TODO: save binary source content as ipa/app/zip

      //TODO: install ipa/app/zip using cli tools: ios for ipa and xcrun for app/zip

    })


    router.on(wire.UninstallIosMessage, function(channel, message) {
      log.info('UnistallIosMessage, channel', channel)
      log.info('UnistallIosMessage, message', message)
      let args = [
        '--id', options.serial,
        ''
      ]
    })
})
