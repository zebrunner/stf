const syrup = require('stf-syrup')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const logger = require('../../../util/logger')

module.exports = syrup
  .dependency(require('../support/push'))
  .dependency(require('./group'))
  .define(function(options, push, group) {
    const log = logger.createLogger('device:plugins:notifier')
    const notifier = {}

    notifier.setDeviceTemporaryUnavialable = function(msg, error) {
      group.get()
        .then((currentGroup) => {
          push.send([
            currentGroup.group,
            wireutil.envelope(new wire.TemporaryUnavailableMessage(
              options.serial
            ))
          ])
        })
        .catch(err => {
          log.error('Cannot set device temporary unavialable', err)
        })
    }

    return notifier
  })
