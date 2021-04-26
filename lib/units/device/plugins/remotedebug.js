const syrup = require('@devicefarmer/stf-syrup')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const logger = require('../../../util/logger')
const Promise = require('bluebird')

module.exports = syrup.serial()
    .dependency(require('./group'))
    .dependency(require('../support/push'))
    .define((options, group, push) => {
        const log = logger.createLogger('remote debug')

        const updateRemoteConnectUrl = (remoteConnectUrl, group) => {
            push.send([
                group.group,
                wireutil.envelope(new wire.UpdateRemoteConnectUrl(
                    options.serial,
                    remoteConnectUrl
                ))
            ])
        }

        group.on('join', (group) => {
            // wait until device will fully be registered before updating remote Connect URL
            Promise.delay(3 * 1000)
                .then(() => {
                    remoteConnectUrl => updateRemoteConnectUrl(remoteConnectUrl, group)
                })
        })

        group.on('leave', () => {
            // do nothing
        })
    })
