var ApkReader = require('@devicefarmer/adbkit-apkreader')
const logger = require('../../../../../util/logger')
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

const appleReaderPromise = (filename) => {
    let id = uuid.v4()
    let tmpDirPath = "/tmp/" + id

    const linuxCommandQuery = [
        `unzip ${filename} "*Info.plist" -d ${tmpDirPath}`,
        `cp \`find ${tmpDirPath} -mindepth 1 -maxdepth 3 -name "Info.plist"\` ${tmpDirPath}`,
        `plistutil -i ${tmpDirPath}/Info.plist -o ${tmpDirPath}/Info.xml`,
        `xml-js ${tmpDirPath}/Info.xml --spaces 4 --out ${filename}.json`,
        `rm -rf ${tmpDirPath}`
    ];

    return new Promise((resolve, reject) => {
      execShellCommand(linuxCommandQuery.join(";")).then(() => {
        parser(path_to_xml).then(data => {
          resolve(data);
        })
      }).catch(err => {log.fatal('Unable to parse ipa/app/zip', err);})
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
