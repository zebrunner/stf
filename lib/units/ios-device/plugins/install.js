const stream = require('stream')
const url = require('url')
const uuid = require('uuid')
const syrup = require('@devicefarmer/stf-syrup')
const request = require('request')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const Promise = require('bluebird')
const mkdir = Promise.promisify(require('fs').mkdir)
var promiseutil = require('../../../util/promiseutil')
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
      var manifest = JSON.parse(message.manifest)

      var reply = wireutil.reply(options.serial)

      function sendProgress(data, progress) {
        push.send([
          channel,
          reply.progress(data, progress)
        ])
      }

      installApp = function() {
        return new Promise(function(resolve, reject) {
            // unzip and install app using xcrun cli tools
            let args = [
                options.serial,
                '*.app',
            ]
            log.info('args "%s"', args)
            let iosInstall = spawn('unzip * && xcrun simctl install', args, {
                cwd: tmpDirPath,
                shell: true
            })

            iosInstall.stdout.on('data', data => {
                log.info('iosInstall.stdout data :', data.toString())
                resolve()
            })

            iosInstall.stderr.on('data', data => {
                log.info('iosInstall.stderr data :', data.toString())
                reject()
            })
        })
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

      // save binary source content as temporary file
      let id = uuid.v4()
      //TODO: read from TMP env var?
      let tmpDirPath = "/tmp/" + id
      var filePath = tmpDirPath + "/" + id

      log.info('mkdir "%s"', tmpDirPath)
      mkdir(tmpDirPath)
        .then(() => {
          const file = fs.createWriteStream(filePath)
          const req2 = https.get(source.uri.href, function(response) {
             response.pipe(file)

             // after download completed close filestream
             file.on("finish", () => {
                 file.close()
                 log.info("Download Completed")

                 var start = 50
                 var end = 90
                 var guesstimate = start
                 sendProgress('installing_app', guesstimate)

                 return promiseutil.periodicNotify(
                     installApp(tmpDirPath),
                     250
                 )
                 .progressed(function() {
                     guesstimate = Math.min(end, guesstimate + 1.5 * (end - guesstimate) / (end - start))
                     sendProgress('installing_app', guesstimate)
                 })
                 .then(function() {
                   if (message.launch) {
		     log.info("manifest: " + manifest)
                     log.info("CFBundleIdentifier:" + manifest.CFBundleIdentifier)
                   }
		 })
                 .then(function() {
                     push.send([
                         channel
                         , reply.okay('INSTALL_SUCCEEDED')
                     ])
                 })
              })
          })
        }).catch(err => log.fatal('Unable to create temp dir', err))
       //TODO: clear tmpDirPath
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
