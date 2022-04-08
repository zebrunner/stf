var ApkReader = require('@devicefarmer/adbkit-apkreader')
const logger = require('../../../../../util/logger')

module.exports = function(file) {
  const log = logger.createLogger('storage:plugins:apk:task')
  log.info("file: " + file)
  log.info("file.path: " + file.path)

  return ApkReader.open(file.path).then(function(reader) {
    return reader.readManifest()
  })
}
