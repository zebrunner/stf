const syrup = require('stf-syrup')
const wireutil = require('../../../wire/util')
const wire = require('../../../wire/')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define((options, router, push) => {
    const url = `http://localhost:${options.streamPort}`
    const reply = wireutil.reply(options.serial)
    router.on(wire.ConnectStartMessage, (channel) => {
      push.send([
        channel
      , reply.okay(url)
      ])
    })
    //   return Promise.resolve()
  })
