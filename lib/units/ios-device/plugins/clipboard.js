const syrup = require('@devicefarmer/stf-syrup')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../plugins/wda/WdaClient'))
  .define(function(options, router, push, wdaClient) {
    router.on(wire.CopyMessage, function(channel) {
      const reply = wireutil.reply(options.serial)
      wdaClient.getClipBoard()
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
