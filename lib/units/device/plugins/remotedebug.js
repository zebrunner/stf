const syrup = require('@devicefarmer/stf-syrup')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const logger = require('../../../util/logger')

module.exports = syrup.serial()
    .dependency(require('./group'))
    .dependency(require('../support/push'))
    .define((options, group, push) => {
        const log = logger.createLogger('remote debug')
        this.remoteAppiumUrl = `http://${options.host}:${options.appiumPort}/wd/hub`

        const updateRemoteConnectUrl = (group) => {
            log.info('remotedebug Appium url: ' + this.remoteAppiumUrl)
            push.send([
                group.group,
                wireutil.envelope(new wire.UpdateRemoteConnectUrl(
                    options.serial,
                    this.remoteAppiumUrl
                ))
            ])
        }

        group.on('join', (group) => {
            updateRemoteConnectUrl(group)
        })

        group.on('leave', () => {
            // do nothing
        })
    })
