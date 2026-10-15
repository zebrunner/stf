import childProcess from 'child_process'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import util from 'util'

import ApkReader from '@devicefarmer/adbkit-apkreader'
import * as uuid from 'uuid'
import yauzl from 'yauzl'

import logger from '../../../../../util/logger.js'
import parsePlistFile, {type PlistObject} from './parser.js'

var execFile = util.promisify(childProcess.execFile)
var log = logger.createLogger('storage:plugins:apk:task')

function openZip(filepath: string) {
  return new Promise<yauzl.ZipFile>(function(resolve, reject) {
    yauzl.open(filepath, {lazyEntries: true}, function(err, zipfile) {
      if (err) {
        reject(err)
      }
      else if (!zipfile) {
        reject(new Error('Unable to open archive'))
      }
      else {
        resolve(zipfile)
      }
    })
  })
}

var APP_INFO_PLIST = /^(?:[^/]+\/){0,2}Info\.plist$/

function extractInfoPlist(filepath: string, destination: string) {
  return openZip(filepath)
    .then(function(zipfile) {
      return new Promise<void>(function(resolve, reject) {
        var done = false

        function finish(err?: Error) {
          if (!done) {
            done = true
            zipfile.close()
            if (err) {
              reject(err)
            }
            else {
              resolve()
            }
          }
        }

        zipfile.on('error', finish)
        zipfile.on('end', function() {
          finish(new Error('Unable to find Info.plist'))
        })
        zipfile.on('entry', function(entry) {
          // Only the app's own plist (Payload/<App>.app/Info.plist), not the ones of embedded
          // frameworks or plugins, like the previous `find -maxdepth 3` did
          if (!APP_INFO_PLIST.test(entry.fileName)) {
            zipfile.readEntry()
            return
          }

          zipfile.openReadStream(entry, function(err, stream) {
            if (err) {
              finish(err)
              return
            }
            if (!stream) {
              finish(new Error('Unable to read Info.plist'))
              return
            }

            var output = fs.createWriteStream(destination)
            stream.on('error', finish)
            output.on('error', finish)
            output.on('finish', function() {
              finish()
            })
            stream.pipe(output)
          })
        })

        zipfile.readEntry()
      })
    })
}

function hasKeys(plist: PlistObject) {
  return Object.keys(plist).length > 0
}

function convertPlist(plistPath: string, convertedPath: string, filepath: string) {
  return execFile('plistutil', ['-i', plistPath, '-o', convertedPath])
    .then(function() {
      return parsePlistFile(convertedPath)
    })
    .then(function(converted) {
      log.info('Parsed plistutil-converted Info.plist from "%s"', filepath)
      return converted
    })
}

function readIosManifest(filepath: string) {
  var workDir = filepath + '.plist-' + uuid.v4()
  var plistPath = path.join(workDir, 'Info.plist')
  var convertedPath = path.join(workDir, 'Info.xml')

  return fsPromises.mkdir(workDir)
    .then(function() {
      return extractInfoPlist(filepath, plistPath)
    })
    .then(function() {
      return parsePlistFile(plistPath)
        .then(function(plist) {
          if (hasKeys(plist)) {
            log.info('Parsed Info.plist from "%s"', filepath)
            return plist
          }

          return convertPlist(plistPath, convertedPath, filepath)
        })
        .catch(function() {
          return convertPlist(plistPath, convertedPath, filepath)
        })
    })
    .finally(function() {
      return fsPromises.rm(workDir, {recursive: true, force: true})
    })
}

export default function(file: {path: string}) {
  log.info('Reading manifest from "%s"', file.path)
  return ApkReader.open(file.path).then(function(reader) {
    return reader.readManifest()
  }).catch(function() {
    return readIosManifest(file.path)
  })
}
