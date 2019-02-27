const util = require('util')
const url = require('url')
const syrup = require('stf-syrup')
const Promise = require('bluebird')
const request = require('request')
const logger = require('../../../util/logger')

module.exports = syrup.serial()
  .define(options => {
    const log = logger.createLogger('device:support:storage')
    let plugin = Object.create(null)

    plugin.store = (type, stream, meta) => {
      log.info('device support storage :', arguments)
      let resolver = Promise.defer()

      let args = {
        url: url.resolve(options.storageUrl, util.format('s/upload/%s', type))
      }
      log.info('device support storage  args :', args)
      let req = request.post(args, (err, res, body) => {
        if (err) {
          log.error('Upload to "%s" failed', args.url, err.stack)
          resolver.reject(err)
        }
        else if (res.statusCode !== 201) {
          log.error('Upload to "%s" failed: HTTP %d', args.url, res.statusCode)
          resolver.reject(new Error(util.format(
            'Upload to "%s" failed: HTTP %d'
            , args.url
            , res.statusCode
          )))
        }
        else {
          try {
            let result = JSON.parse(body)
            log.info('Uploaded to "%s"', result.resources.file.href)
            resolver.resolve(result.resources.file)
          }
          catch (err) {
            log.error('Invalid JSON in response', err.stack, body)
            resolver.reject(err)
          }
        }
      })

      req.form()
        .append('file', stream, meta)

      return resolver.promise
    }

    return plugin
  })
