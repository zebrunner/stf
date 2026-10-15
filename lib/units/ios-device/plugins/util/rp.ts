import Promise from 'bluebird'
import request from '@cypress/request'

import type {
  RpOptions
, RpRequestError
, RpStatusCodeError
} from '../../../../types/ios-device.js'

export default function rp<T = unknown>(options: RpOptions): Promise<T> {
  return new Promise<T>(function(resolve, reject) {
    request(options as request.TextOptions, function(err, response, body) {
      var responseBody = body as unknown
      if (err) {
        var requestError = new Error(String(err)) as RpRequestError
        requestError.name = 'RequestError'
        requestError.cause = err
        requestError.error = err
        requestError.options = options
        reject(requestError)
        return
      }

      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve(responseBody as T)
        return
      }

      var statusCode = response.statusCode || 0
      var statusError = new Error(
        statusCode + ' - ' + (
          typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
        )
      ) as RpStatusCodeError
      statusError.name = 'StatusCodeError'
      statusError.statusCode = statusCode
      statusError.error = responseBody
      statusError.options = options
      statusError.response = response
      reject(statusError)
    })
  })
}
