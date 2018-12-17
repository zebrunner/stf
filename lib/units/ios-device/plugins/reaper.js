const syrup = require('stf-syrup')
const logger = require('../../../util/logger')
const Promise = require('bluebird')

module.exports = syrup.serial()
  .dependency(require('./wda'))
  .define((opetions, wda) => {
    // const log = logger.createLogger('device:reaper')
    // const reaper = () => {
    //   return new Promise((resolve, reject) => {
    //     setTimeout(() => {
    //       wda.connect()
    //         .then(() => {
    //           log.info('STF successfully connected to WDA')
    //           resolve()
    //         })
    //         .catch(err => {
    //           log.error('STF failed connect to WDA')
    //           reject()
    //         })
    //     }, 60 * 1000)
    //   })
    // }
    return {reaper: reaper}
  })
