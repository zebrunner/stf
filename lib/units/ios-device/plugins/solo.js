var crypto = require('crypto')

var syrup = require('stf-syrup')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')

module.exports = syrup.serial()
   .dependency(require('../support/sub'))
  .dependency(require('../support/push'))
  .define(function(options, sub, push) {
    var log = logger.createLogger('device:plugins:solo')

    // The channel should keep the same value between restarts, so that
    // having the client side up to date all the time is not horribly painful.
    function makeChannelId() {
      var hash = crypto.createHash('sha1')
      hash.update(options.serial)
      return hash.digest('base64')
    }

    var channel = makeChannelId()

    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)

    return {
      channel: channel
      , poke: function() {
        push.send([
          wireutil.global
          , wireutil.envelope(new wire.DeviceReadyMessage(
            options.serial
            , channel
          ))
        ])
      }
    }
  })
