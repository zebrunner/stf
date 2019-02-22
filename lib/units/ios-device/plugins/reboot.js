const syrup = require('stf-syrup')
const Promise = require('bluebird')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const {exec} = require('child_process')

module.exports = syrup.serial()
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .define(function(options, router, push) {
    const log = logger.createLogger('device:plugins:reboot')

    router.on(wire.RebootMessage, function(channel) {
        const reply = wireutil.reply(options.serial)
        exec(`idevicediagnostics -u ${options.serial} restart`, (err, stdout, stderr) => {
         log.ingo(stdout)
         })
         Promise.delay(5000)
         .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
          })
          .error(function(err) {
            log.error('Reboot failed', err.stack)
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
    })
  })
