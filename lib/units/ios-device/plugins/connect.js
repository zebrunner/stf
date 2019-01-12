const syrup = require('stf-syrup')
const wireutil = require('../../../wire/util')
const wire = require('../../../wire/')
const Promise = require('bluebird')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, router, push) {
    const url = `http://localhost:${options.streamPort}`
    const reply = wireutil.reply(options.serial)
    router.on(wire.ConnectStartMessage, function(channel) {
      push.send([
        channel
      , reply.okay(url)
      ])
    })
    //   return Promise.resolve()
  })
