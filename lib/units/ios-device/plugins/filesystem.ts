import fs from 'fs'
import os from 'os'
import path from 'path'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {
  IosDeviceOptions
, IosFilesystemPlugin
, IosStoragePlugin
, Push
, Router
} from '../../../types/ios-device.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import storageSyrup from '../support/storage.js'
import {afcPath, execGoIos, parseFsyncTree} from './util/goios.js'

// The File Explorer: the media directory of the device (AFC: DCIM, Downloads, ...) through
// `ios fsync`; AFC gives no sizes, dates or permissions of the entries
export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(storageSyrup)
  .define(function(
    options: IosDeviceOptions
  , router: Router
  , push: Push
  , storage: IosStoragePlugin
  ) {
    var log = logger.createLogger('device:plugins:filesystem')
    var plugin = Object.create(null) as IosFilesystemPlugin

    plugin.list = function(dir) {
      return Promise.try(function() {
        return execGoIos(options.serial, ['fsync', 'tree', '--path=' + afcPath(dir)])
      })
        .then(function(result) {
          return parseFsyncTree(result.stdout)
        })
    }

    plugin.retrieve = function(file) {
      var tmpDir: string | null = null
      return Promise.try(function() {
        var remote = afcPath(file)
        if (remote === '/') {
          throw new Error('Not a file')
        }
        var name = path.posix.basename(remote)
        return Promise.resolve(fs.promises.mkdtemp(path.join(os.tmpdir(), 'stf-afc-')))
          .then(function(dir) {
            tmpDir = dir
            return execGoIos(options.serial, [
              'fsync'
            , 'pull'
            , '--srcPath=' + remote
            , '--dstPath=' + dir
            ])
          })
          .then(function() {
            return fs.promises.stat(path.join(tmpDir!, name))
          })
          .then(function(stats) {
            if (!stats.isFile()) {
              throw new Error('Not a file')
            }
            return storage.store('blob', fs.createReadStream(path.join(tmpDir!, name)), {
              filename: name
            , contentType: 'application/octet-stream'
            , knownLength: stats.size
            })
          })
      })
        .finally(function() {
          if (tmpDir) {
            return fs.promises.rm(tmpDir, {recursive: true, force: true})
          }
          return null
        })
    }

    router.on(wire.FileSystemListMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)
      plugin.list(message.dir)
        .then(function(files) {
          push.send([channel, reply.okay('success', files)])
        })
        .catch(function(err) {
          log.warn('Unable to list directory "%s"', message.dir, err.stack)
          push.send([channel, reply.fail(err.message)])
        })
    })

    router.on(wire.FileSystemGetMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)
      plugin.retrieve(message.file)
        .then(function(file) {
          push.send([channel, reply.okay('success', file)])
        })
        .catch(function(err) {
          log.warn('Unable to retrieve "%s"', message.file, err.stack)
          push.send([channel, reply.fail(err.message)])
        })
    })

    return plugin
  })
