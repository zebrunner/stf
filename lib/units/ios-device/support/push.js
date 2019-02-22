const syrup = require('stf-syrup')
const Promise = require('bluebird')
const logger = require('../../../util/logger')
const srv = require('../../../util/srv')
const zmqutil = require('../../../util/zmqutil')

module.exports = syrup.serial()
  .define(function(options) {
    const log = logger.createLogger('device:support:push')

    // Output
    let push = zmqutil.socket('push')

    return Promise.map(options.endpoints.push, function(endpoint) {
      return srv.resolve(endpoint).then(function(records) {
        return srv.attempt(records, function(record) {
          log.info('Ios device sending output to "%s"', record.url)
          push.connect(record.url)
          return Promise.resolve(true)
        })
      })
    })
      .return(push)
  })
