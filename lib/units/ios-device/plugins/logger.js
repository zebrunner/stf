const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../util/logger')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')

module.exports = syrup.serial()
  .dependency(require('../support/push'))
  .define((options, push) => {
    // Forward all logs
    logger.on('entry', entry => {
      push.send([
        wireutil.global
        , wireutil.envelope(new wire.DeviceLogMessage(
          options.serial
          , entry.timestamp / 1000
          , entry.priority
          , entry.tag
          , entry.pid
          , entry.message
          , entry.identifier
        ))
      ])
    })

    return logger
  })
