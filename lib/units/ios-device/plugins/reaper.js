const syrup = require('stf-syrup')
const request = require('requestretry')
const Promise = require('bluebird')

module.exports = syrup.serial()
  // .dependency(require('./wda'))
  .define((opetions) => {
    return {
      tryToConnectWda: function() {
        return new Promise((resolve, reject) => {
          request({
            url: 'http://192.168.0.123:8100',
            json: true,
            maxAttempts: 120,
            retryDelay: 1000 * 10,
            retryStrategy: request.RetryStrategies.HTTPOrNetworkError
          }, function(err, response, body) {
            if(err) {
              return reject(err)
            }
            if (response) {
              return resolve()
            }
          })
        })
      }
    }
  })
