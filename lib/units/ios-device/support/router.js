const syrup = require('@devicefarmer/stf-syrup')
const wirerouter = require('../../../wire/router')

module.exports = syrup.serial()
  .dependency(require('./sub'))
  .dependency(require('./channels'))
  .define((options, sub, channels) => {
    let router = wirerouter()

    sub.on('message', router.handler())

    // Special case, we're hooking into a message that's not actually routed.
    router.on({$code: 'message'}, channel => {
      channels.keepalive(channel)
    })

    return router
  })
