const util = require('util')
const url = require('url')
const syrup = require('@devicefarmer/stf-syrup')
const Promise = require('bluebird')
const request = require('@cypress/request')
const logger = require('../../../util/logger')

module.exports = syrup.serial()
  .define(options => {
    const log = logger.createLogger('device:support:storage')
    let plugin = Object.create(null)

    plugin.store = function(type, stream, meta) {
      var resolve_, reject_
      var promise = new Promise(function(resolve, reject) {
        resolve_ = resolve
        reject_ = reject
      })

      var args = {
        url: url.resolve(options.storageUrl, util.format('s/upload/%s', type))
      }
      var req = request.post(args, function(err, res, body) {
        if (err) {
          log.error('Upload to "%s" failed', args.url, err.stack)
          reject_(err)
        }
        else if (res.statusCode !== 201) {
          log.error('Upload to "%s" failed: HTTP %d', args.url, res.statusCode)
          reject_(new Error(util.format(
            'Upload to "%s" failed: HTTP %d'
            , args.url
            , res.statusCode
          )))
        }
        else {
          try {
            let result = JSON.parse(body)
            log.info('Uploaded to "%s"', result.resources.file.href)
            resolve_(result.resources.file)
          }
          catch (err) {
            log.error('Invalid JSON in response', err.stack, body)
            reject_(err)
          }
        }
      })

      req.form()
        .append('file', stream, meta)

      return promise
    }

    return plugin
  })
