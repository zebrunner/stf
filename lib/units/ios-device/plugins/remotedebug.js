const syrup = require('stf-syrup')
const wire = require('../../../wire')
const wireutil = require('../../../wire/util')
const logger = require('../../../util/logger')
const AppiumProxyServer = require('../../../util/AppiumProxyServer')
const Promise = require('bluebird')

module.exports = syrup.serial()
    .dependency(require('./group'))
    .dependency(require('../support/push'))
    .define((options, group, push) => {
        const log = logger.createLogger('remote debug')
        const proxyServer = new AppiumProxyServer({
            stfAppiumPort: options.stfAppiumPort,
            publicNodeIp: options.publicNodeIp,
            appiumPort: options.appiumPort
        })

        const disconnectProxyServer = () => {
            proxyServer.disconnect()
                .then(() => log.info('successfully closed appium proxy server'))
                .catch(err => log.error(err))
        }

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
                    proxyServer.connect()
                        .then(remoteConnectUrl => updateRemoteConnectUrl(remoteConnectUrl, group))
                        .catch(err => log.error(err))
                })
        })

        group.on('leave', () => {
            disconnectProxyServer()
        })
    })
