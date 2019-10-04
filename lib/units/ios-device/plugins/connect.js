const syrup = require('stf-syrup')
const wireutil = require('../../../wire/util')
const wire = require('../../../wire/')
const wirerouter = require("../../../wire/router")
const logger = require("../../../util/logger")

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../plugins/wda'))
  .define((options, router, push, wda) => {
    const reply = wireutil.reply(options.serial)
    const url = `http://localhost:${options.wdaPort}`
    const log = logger.createLogger('connect')
    router.on(wire.ConnectStartMessage, (channel) => {
      push.send([
        channel
      , reply.okay(url)
      ])
    })
  })
