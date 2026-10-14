// Minimal replacement for the deprecated request-promise package on top of
// @cypress/request. Resolves with the response body for 2xx responses and
// rejects with an error exposing `statusCode` and `error` (the response body)
// otherwise, matching the request-promise contract the iOS plugins rely on.
const Promise = require('bluebird')
const request = require('@cypress/request')

module.exports = function rp(options) {
  return new Promise(function(resolve, reject) {
    request(options, function(err, response, body) {
      if (err) {
        const requestError = new Error(String(err))
        requestError.name = 'RequestError'
        requestError.cause = err
        requestError.error = err
        requestError.options = options
        return reject(requestError)
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return resolve(body)
      }

      const statusError = new Error(
        response.statusCode + ' - ' + (typeof body === 'string' ? body : JSON.stringify(body))
      )
      statusError.name = 'StatusCodeError'
      statusError.statusCode = response.statusCode
      statusError.error = body
      statusError.options = options
      statusError.response = response
      return reject(statusError)
    })
  })
}
