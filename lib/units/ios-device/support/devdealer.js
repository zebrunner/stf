var syrup = require('stf-group')

var zmqutil = require('../../../util/zmqutil')
var logger = require('../../../util/logger')
var Promise = require('bluebird')
var srv = require('../../../util/srv')
var lifecycle = require('../../../util/lifecycle')

module.exports = syrup
  .serial()
  .define(function(options) {
    var log = logger.createLogger('dev')
    var appDealer = zmqutil.socket('dealer')
    Promise.map(options.endpoints.appDealer, function(endpoint) {
      return srv.resolve(endpoint).then(function(records) {
        return srv.attempt(records, function(record) {
          log.info('App dealer connected to "%s"', record.url)
          appDealer.connect(record.url)
          return Promise.resolve(true)
        })
      })
    })
      .catch(function(err) {
        log.fatal('Unable to connect to app dealer endpoint', err)
        lifecycle.fatal()
      })
      .return(appDealer)
  })
