const crypto = require('crypto')
const syrup = require('stf-syrup')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const lifecycle = require('../../../util/lifecycle')
const wireutil = require('../../../wire/util')

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
            push.send([
              wireutil.global
              , wireutil.envelope(new wire.DeviceReadyMessage(
                options.serial
                , channel
              ))
            ])
          })
          .catch(err => {
            log.error(err)
            lifecycle.fatal(err)
          })
      }
    }
  })
