const syrup = require('stf-syrup')
const Promise = require('bluebird')
const logger = require('../../../util/logger')
const srv = require('../../../util/srv')
const lifecycle = require('../../../util/lifecycle')
const zmqutil = require('../../../util/zmqutil')

module.exports = syrup.serial()
  .define(options => {
    const log = logger.createLogger('device:support:push')

    // Output
    let push = zmqutil.socket('push')

    return Promise.map(options.endpoints.push, endpoint => {
      return srv.resolve(endpoint).then(records => {
        return srv.attempt(records, record => {
          log.info('Ios device sending output to "%s"', record.url)
          push.connect(record.url)
          return Promise.resolve(true)
        })
      })
    })
    .catch(function(err) {
      log.fatal('Unable to connect to sub endpoint', err)
      lifecycle.fatal()
    })
      .return(push)
  })
