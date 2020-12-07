const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../util/logger')
const ChannelManager = require('../../../wire/channelmanager')

module.exports = syrup.serial()
  .define(() => {
    const log = logger.createLogger('device:support:channels')
    let channels = new ChannelManager()
    channels.on('timeout', channel => {
      log.info('Channel "%s" timed out', channel)
    })
    return channels
  })
