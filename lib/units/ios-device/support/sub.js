const syrup = require('stf-syrup')
const Promise = require('bluebird')
const logger = require('../../../util/logger')
const wireutil = require('../../../wire/util')
const srv = require('../../../util/srv')
require('../../../util/lifecycle')
const zmqutil = require('../../../util/zmqutil')

module.exports = syrup.serial()
  .define(function(options) {
    const log = logger.createLogger('device:support:sub')

    // Input
    let sub = zmqutil.socket('sub')

    return Promise.map(options.endpoints.sub, function(endpoint) {
      return srv.resolve(endpoint).then(function(records) {
        return srv.attempt(records, function(record) {
          log.info('Receiving input from "%s"', record.url)
          sub.connect(record.url)
          return Promise.resolve(true)
        })
      })
    })
      .then(function() {
        // Establish always-on channels
        [wireutil.global].forEach(function(channel) {
          log.info('Subscribing to permanent channel "%s"', channel)
          sub.subscribe(channel)
        })
      })
      .return(sub)
  })
