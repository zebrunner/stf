var ApkReader = require('@devicefarmer/adbkit-apkreader')
const logger = require('../../../../../util/logger')
const parser = require('./parser')
const fs = require('fs')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const uuid = require('uuid')


function execShellCommand(cmd) {
    const exec = require('child_process').exec;
    return new Promise((resolve, reject) => {
     exec(cmd, (error, stdout, stderr) => {
      if (error) {
       console.warn(error);
      }
      stdout ? resolve(stdout) : reject(stderr);
     });
    });
}

const appleReaderPromise = (filepath) => {
    let id = uuid.v4()
    let tmpDirPath = "/tmp/" + id

    const linuxCommandQuery = [
        `unzip ${filepath} "*Info.plist" -d ${tmpDirPath}`,
        `cp \`find ${tmpDirPath} -mindepth 1 -maxdepth 3 -name "Info.plist"\` ${tmpDirPath}`,
        `cp ${tmpDirPath}/Info.plist ${filepath}.xml`,
        `plistutil -i ${tmpDirPath}/Info.plist -o ${filepath}_2.xml`,
        `rm -rf ${tmpDirPath}`
    ];

    return new Promise((resolve, reject) => {
      execShellCommand(linuxCommandQuery.join(";")).then(() => {
        parser(`${filepath}.xml`).then(data => {
          if (data != "{}") {
            console.info(`Parsed original Info.plist from ${filepath}.xml`)
            resolve(data)
          } else {
            parser(`${filepath}_2.xml`).then(data => {
              console.info(`Parsed converted by plistutil Info.plist from ${filepath}_2.xml`)
              console.info(data)
              resolve(data)
            })
          }
        }).catch(err => {
          console.error('Unable to parse Info.plist', err)
          reject(err)
        })
      }).catch(err => {
        console.error('Unable to find Info.plist', err)
        reject(err)
      })
    })
}

module.exports = function(file) {
    const log = logger.createLogger('storage:plugins:apk:task')
    log.info("file.path: " + file.path)

    return ApkReader.open(file.path).then(function(reader) {
      return reader.readManifest()
    }).catch(err => {
          return appleReaderPromise(file.path);
    })
}
