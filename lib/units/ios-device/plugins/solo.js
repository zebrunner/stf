const crypto = require('crypto')
const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const lifecycle = require('../../../util/lifecycle')
const wireutil = require('../../../wire/util')
const Promise = require('bluebird')

module.exports = syrup.serial()
  .dependency(require('../support/sub'))
  .dependency(require('../support/push'))
  .dependency(require('../plugins/info'))
  .define((options, sub, push, info) => {
    const log = logger.createLogger('device:plugins:solo')

    // The channel should keep the same value between restarts, so that
    // having the client side up to date all the time is not horribly painful.
    let makeChannelId = () => {
      let hash = crypto.createHash('sha1')
      hash.update(options.serial)
      return hash.digest('base64')
    }

    let channel = makeChannelId()

    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)

    return {
      channel: channel
      , poke: () => {
        info.manageDeviceInfo()
          .then(() => {
            // wait until device will be registered
            Promise.delay(3 * 1000)
              .then(() => {
                push.send([
                  wireutil.global
                  , wireutil.envelope(new wire.DeviceReadyMessage(
                    options.serial
                    , channel
                  ))
                ])

                // #410: Use status 6 (preparing) on WDA startup
                push.send([
                  wireutil.global,
                  wireutil.envelope(new wire.DeviceStatusMessage(
                    options.serial,
                    6
                  ))
                ])
              })
          })
          .catch(err => {
            log.error('catch managerinfo', err)
            lifecycle.fatal(err)
          })
      }
    }
  })
