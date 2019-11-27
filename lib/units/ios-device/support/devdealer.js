const syrup = require('stf-group')
const zmqutil = require('../../../util/zmqutil')
const logger = require('../../../util/logger')
const Promise = require('bluebird')
const srv = require('../../../util/srv')
const lifecycle = require('../../../util/lifecycle')

module.exports = syrup
  .serial()
  .define(options => {
    const log = logger.createLogger('dev')
    let appDealer = zmqutil.socket('dealer')
    Promise.map(options.endpoints.appDealer, endpoint => {
      return srv.resolve(endpoint).then(records => {
        return srv.attempt(records, record => {
          log.info('App dealer connected to "%s"', record.url)
          appDealer.connect(record.url)
          return Promise.resolve(true)
        })
      })
    })
      .catch(err => {
        log.fatal('Unable to connect to app dealer endpoint', err)
        lifecycle.fatal(err)
      })
      .return(appDealer)
  })
