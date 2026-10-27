import childProcess from 'child_process'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'
import * as uuid from 'uuid'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import promiseutil from '../../../util/promiseutil.js'
import storageauth from '../../../util/storageauth.js'
import type {IosDeviceOptions, Push, Router} from '../../../types/ios-device.js'
import routerSyrup from '../support/router.js'
import pushSyrup from '../support/push.js'
import {GO_IOS_BIN} from './util/goios.js'

const mkdir = Promise.promisify(fs.mkdir)

// An app bundle identifier of Apple: letters, digits, hyphens and periods. It comes with the manifest of the
// user, it is never a part of a shell command
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
// The download of an app from the storage ends when it sends nothing for this time
const DOWNLOAD_IDLE_TIMEOUT = 60 * 1000

type Log = ReturnType<typeof logger.createLogger>
type Channel = string | Buffer
type SendProgress = (data: string, progress: number) => void

interface IosManifest {
  DTPlatformName?: string
  CFBundleIdentifier?: string
}

// run <file> <args>: the command without a shell, its output
function run(file: string, args: string[]) {
  return new Promise<string>(function(resolve, reject) {
    childProcess.execFile(file, args, function(error, stdout) {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

// the app of a simulator build: the .app of the zip, at its root or in Payload/
function findSimulatorApp(dir: string): string {
  for (var candidate of [dir, path.join(dir, 'Payload')]) {
    var app = fs.existsSync(candidate) && fs.readdirSync(candidate).find(function(name) {
      return name.endsWith('.app')
    })
    if (app) {
      return path.join(candidate, app)
    }
  }
  throw new Error('No .app in the simulator build')
}

function installApp(udid: string, filepath: string, id: string, isSimulator: boolean) {
  if (isSimulator) {
    return run('unzip', ['-o', '-q', path.join(filepath, id), '-d', filepath])
      .then(function() {
        return run('xcrun', ['simctl', 'install', udid, findSimulatorApp(filepath)])
      })
      .then(function() {})
  }
  return run(GO_IOS_BIN, ['install', `--path=${path.join(filepath, id)}`, `--udid=${udid}`])
    .then(function() {})
}

function launchApp(udid: string, bundleId: string, isSimulator: boolean) {
  return (isSimulator ?
    run('xcrun', ['simctl', 'launch', udid, bundleId]) :
    run(GO_IOS_BIN, ['launch', bundleId, `--udid=${udid}`]))
    .then(function() {})
}

function isSimulatorManifest(manifest: IosManifest): boolean {
  return Boolean(manifest.DTPlatformName?.includes('simulator'))
}

function createProgressSender(
  options: IosDeviceOptions
, push: Push
, channel: Channel
): SendProgress {
  var reply = wireutil.reply(options.serial)

  return function(data: string, progress: number) {
    push.send([
      channel
    , reply.progress(data, progress)
    ])
  }
}

function downloadFile(
  downloadUrl: string
, filePath: string
, httpServer: typeof http | typeof https
, sendProgress: SendProgress
) {
  return new Promise<void>(function(resolve, reject) {
    var file = fs.createWriteStream(filePath)

    function handleResponse(response: http.IncomingMessage) {
      var totalSize = Number(response.headers['content-length'])
      var pushStart = 50
      var pushEnd = 60
      var downloadedSize = 0

      response.pipe(file)
      response.on('data', function(chunk: Buffer) {
        downloadedSize += chunk.length
        sendProgress(
          'pushing_app'
        , Math.round((downloadedSize / totalSize) * (pushEnd - pushStart) + pushStart)
        )
      })
      file.on('finish', function() {
        file.close()
        resolve()
      })
    }

    file.on('error', reject)
    var headers = storageauth.internalHeaders()
    var req = httpServer.get(downloadUrl, {headers: headers}, function(response) {
      // an answer of the storage that is not the app (e.g. 401 of the authentication) is not installed
      if (response.statusCode !== 200) {
        response.resume()
        file.close()
        reject(new Error(`The storage answered ${response.statusCode} for the app`))
        return
      }
      handleResponse(response)
    })
    req.on('error', reject)
    req.setTimeout(DOWNLOAD_IDLE_TIMEOUT, function() {
      req.destroy(new Error('The download of the app from the storage timed out'))
    })
  })
}

function installDownloadedApp(
  options: IosDeviceOptions
, manifest: IosManifest
, tmpDirPath: string
, id: string
, sendProgress: SendProgress
, log: Log
) {
  var start = 60
  var end = 95
  var guesstimate = start
  var isSimulator = isSimulatorManifest(manifest)

  sendProgress('installing_app', guesstimate)
  log.info('isSimulator: ' + isSimulator)

  return promiseutil.periodicNotify(
    installApp(options.serial, tmpDirPath, id, isSimulator)
  , 250
  , function() {
      guesstimate = Math.min(
        end
      , guesstimate + 1.5 * (end - guesstimate) / (end - start)
      )
      sendProgress('installing_app', guesstimate)
    }
  )
}

function maybeLaunchApp(
  options: IosDeviceOptions
, manifest: IosManifest
, isSimulator: boolean
, shouldLaunch: boolean
, sendProgress: SendProgress
, log: Log
) {
  if (shouldLaunch) {
    var bundleId = manifest.CFBundleIdentifier
    log.info('CFBundleIdentifier: ' + bundleId)
    sendProgress('launching_app', 100)
    if (bundleId && BUNDLE_ID.test(bundleId)) {
      launchApp(options.serial, bundleId, isSimulator)
        .catch(function(err: Error) {
          log.error('Unable to launch "%s"', bundleId, err.message)
        })
    }
    else if (bundleId) {
      log.warn('The app is not launched, its bundle identifier is invalid: %s'
      , JSON.stringify(bundleId))
    }
  }
}

function sendInstallFailure(
  push: Push
, channel: Channel
, options: IosDeviceOptions
, manifest: IosManifest
, err: Error
, log: Log
) {
  var errorReply = 'INSTALL_ERROR_UNKNOWN'
  var reply = wireutil.reply(options.serial)

  log.error(
    'Installation of package "%s" failed'
  , manifest.CFBundleIdentifier
  , err.stack
  )

  var stack = typeof err.stack === 'string' ? err.stack : ''
  if (stack.includes('ApplicationVerificationFailed')) {
    errorReply = 'INSTALL_ERROR_APP_SIGNING'
  }

  push.send([
    channel
  , reply.fail(errorReply)
  ])
}

function handleInstall(
  options: IosDeviceOptions
, push: Push
, log: Log
, channel: Channel
, message: InstanceType<typeof wire.InstallMessage>
) {
  log.info('Installing application from "%s"', message.href)

  var manifest = JSON.parse(message.manifest || '{}') as IosManifest
  var reply = wireutil.reply(options.serial)
  var sendProgress = createProgressSender(options, push, channel)
  var id = uuid.v4()
  var tmpDirPath = '/tmp/' + id
  var filePath = tmpDirPath + '/' + id

  log.info('mkdir "%s"', tmpDirPath)

  mkdir(tmpDirPath)
    .then(function() {
      // only a file of the storage gets the token of the deployment, the href comes from the user
      var downloadUrl = storageauth.storageUrl(options.storageUrl, message.href || '')
      var httpServer = downloadUrl.startsWith('https:') ? https : http
      log.info('url: ', downloadUrl)
      return downloadFile(downloadUrl, filePath, httpServer, sendProgress)
    })
    .then(function() {
      log.info('Download Completed')
      var isSimulator = isSimulatorManifest(manifest)
      return installDownloadedApp(options, manifest, tmpDirPath, id, sendProgress, log)
        .then(function() {
          maybeLaunchApp(options, manifest, isSimulator, message.launch, sendProgress, log)
        })
    })
    .then(function() {
      push.send([
        channel
      , reply.okay('INSTALL_SUCCEEDED')
      ])
    })
    .catch(function(err) {
      sendInstallFailure(push, channel, options, manifest, err, log)
    })
    .finally(function() {
      // the downloaded app and the unzipped simulator build
      return fs.promises.rm(tmpDirPath, {recursive: true, force: true}).catch(function() {})
    })
}

export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .define(function(options: IosDeviceOptions, router: Router, push: Push) {
    var log = logger.createLogger('device:plugins:install')

    router.on(wire.InstallMessage, function(channel, message) {
      handleInstall(options, push, log, channel, message)
    })
  })
