const syrup = require('@devicefarmer/stf-syrup')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const logger = require('../../../util/logger')

module.exports = syrup.serial()
    .dependency(require('./group'))
    .dependency(require('../support/push'))
    .define((options, group, push) => {
        const log = logger.createLogger('remote debug')
        let remoteAppiumUrl = `http://${options.host}:${options.appiumPort}/wd/hub`

        const updateRemoteConnectUrl = (url, group) => {
            push.send([
                group.group,
                wireutil.envelope(new wire.UpdateRemoteConnectUrl(
                    options.serial,
                    url
                ))
            ])
        }

        group.on('join', (group) => {
            log.info('joined remotedebug for Appium url: ' + this.remoteAppiumUrl)
            updateRemoteConnectUrl(this.remoteAppiumUrl, group)
        })

        group.on('leave', () => {
            log.info('leaved remotedebug for Appium url: ' + this.remoteAppiumUrl)
        })
    })
