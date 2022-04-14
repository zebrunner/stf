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
//TODO: add http as well
const https = require('https')
const fs = require('fs')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
var promiseutil = require('../../../util/promiseutil')

function execShellCommand(cmd) {
  const exec = require('child_process').exec;
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      }
      resolve(stdout);
    });
  });
}

const installApp = (udid, filepath, id, isSimulator) => {
    const simulatorCommands = [
        `cd ${filepath} && unzip * && xcrun simctl install ${udid} *.app`,
    ];

    const deviceCommands = [
        `ios install --path=${filepath}/${id} --udid=${udid}`,
    ];

    let commands = deviceCommands
    if (isSimulator) {
      commands = simulatorCommands
    }

    return new Promise((resolve, reject) => {
      execShellCommand(commands.join(";")).then(() => {
        resolve()
      }).catch(err => {
        reject(err)
      })
    })
}

const launchApp = (udid, bundleId, isSimulator) => {
    const simulatorCommands = [
        `xcrun simctl launch ${udid} ${bundleId}`,
    ];

    const deviceCommands = [
        `ios launch ${bundleId} --udid=${udid}`,
    ];

    let commands = deviceCommands
    if (isSimulator) {
      commands = simulatorCommands
    }

    return new Promise((resolve, reject) => {
      execShellCommand(commands.join(";")).then(() => {
        resolve()
      }).catch(err => {
        reject(err)
      })
    })
}



module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, router, push) {
    const log = logger.createLogger('device:plugins:install')

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

            const totalSize = response.headers['content-length'];
            let pushStart = 50;
            let pushEnd = 60;
            let progress;

            let downloadedSize = 0;
            response.on("data", (chunk) => {
                downloadedSize += chunk.length;
                sendProgress('pushing_app', progress = Math.round((downloadedSize / totalSize) * (pushEnd - pushStart) + pushStart));
            })

             // after download completed close filestream
             file.on("finish", () => {
                 file.close()
                 log.info("Download Completed")

                 var start = 60
                 var end = 95
                 var guesstimate = start
                 sendProgress('installing_app', guesstimate)
                 isSimulator = manifest.DTPlatformName.includes("simulator")
                 log.info("isSimulator: " + isSimulator)
                 return promiseutil.periodicNotify(
                   installApp(options.serial, tmpDirPath, id, isSimulator)
                   , 250
                 )
                 .progressed(function() {
                   guesstimate = Math.min(end, guesstimate + 1.5 * (end - guesstimate) / (end - start))
                   // log.info("guesstimate: " + guesstimate)
                   sendProgress('installing_app', guesstimate)
                 })
                 .then(function() {
                   if (message.launch) {
                     log.info("CFBundleIdentifier: " + manifest.CFBundleIdentifier)
                     // Progress 90%
                     sendProgress('launching_app', 100)
                     launchApp(options.serial, manifest.CFBundleIdentifier, isSimulator)
                   }
                 })
                 .then(function() {
                     push.send([
                         channel
                         , reply.okay('INSTALL_SUCCEEDED')
                     ])
                 })
                 .catch(function(err) {
                   log.error('Installation of package "%s" failed', manifest.CFBundleIdentifier, err.stack)
                   push.send([
                     channel
                     , reply.fail('INSTALL_ERROR_UNKNOWN')
                   ])
                 })
              })
            //TODO: clear tmpDirPath
          })
        }).catch(err => log.fatal('Unable to create temp dir', err))
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
