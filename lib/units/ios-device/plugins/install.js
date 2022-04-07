const stream = require('stream')
const url = require('url')
const syrup = require('@devicefarmer/stf-syrup')
const request = require('request')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
//TODO: add http as well
const https = require('https')
const fs = require('fs')
const {spawn} = require('child_process')

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
      var reqInfo = new stream.Readable().wrap(req)
      log.info("regInfo: " + JSON.stringify(reqInfo))

      var sourceInfo = JSON.stringify(reqInfo)
      var source = JSON.parse(sourceInfo)
      log.info("source.uri.href: " + source.uri.href)

      //TODO: save binary source content as ipa/app/zip
      var filePath = "/tmp/222.ipa"
      const file = fs.createWriteStream(filePath)
      const req2 = https.get(source.uri.href, function(response) {
         response.pipe(file)

         // after download completed close filestream
         file.on("finish", () => {
             file.close()
             console.log("Download Completed")

             //TODO: install ipa/app/zip using cli tools: ios for ipa and xcrun for app/zip
             let args = [
               options.serial,
               filePath,
             ]
             log.info('args "%s"', args)
             let iosInstall = spawn('xcrun simctl install', args, {
               //cwd: tmpDirPath,
               shell: true
             })

             iosInstall.stdout.on('data', data => {
               // @TODO add handler
               log.info('iosInstall.stdout data :', data.toString())
               // var output = data.toString()
             })

             iosInstall.stderr.on('data', data => {
               log.info('iosInstall.stderr data :', data.toString())
             })
         })
      })
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
