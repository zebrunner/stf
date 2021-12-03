const syrup = require('@devicefarmer/stf-syrup')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')
const logger = require('../../../../util/logger')
const Promise = require('bluebird')

module.exports = syrup.serial()
  .dependency(require('../../support/push'))
  .define((options, push) => {
    const log = logger.createLogger('device:info')

    function manageDeviceInfo() {
      return new Promise((resolve, reject) => {
        log.info("device.name: " + options.deviceName)

        let solo = wireutil.makePrivateChannel()

        push.send([
          wireutil.global
          , wireutil.envelope(new wire.InitializeIosDeviceState(
            options.serial
            , wireutil.toDeviceStatus('device')
            , new wire.ProviderIosMessage(
              solo,
              options.provider,
              options.screenWsUrlPattern || ''
            )
            , new wire.IosDevicePorts(
              options.screenPort,
              options.connectPort
            )
            , new wire.UpdateIosDevice(
              options.serial,
              options.deviceName,
              "TODO: iOS",
              "TODO: amd64"
            )
          ))
        ])

        return resolve()
      })
      .catch(err => {
        return reject()
      })
    }
    return {
      manageDeviceInfo
    }
  })
