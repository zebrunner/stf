const syrup = require('stf-syrup')

const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const path = require('path')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../plugins/clipboard/clipboardutil'))
  .define(function(options, router, push, clipboardutil) {
    const log = logger.createLogger('ios-device:clickboard')

    router.on(wire.CopyMessage, function(channel) {
      const reply = wireutil.reply(options.serial)
      clipboardutil.getClipBoard()
        .then(clipboard => {
          push.send([
            channel
            , reply.okay(clipboard)
          ])
        })
        .catch(err => {
          push.send([
            channel
            , reply.fail('')
          ])
        })
    })
  })
