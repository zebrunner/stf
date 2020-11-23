const syrup = require('stf-syrup')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')
const logger = require('../../../../util/logger')
const Promise = require('bluebird')
const IosDeviceParser = require('./IosDeviceParser')

module.exports = syrup.serial()
  .dependency(require('../../support/push'))
  .define((options, push) => {
    const iosDeviceParser = new IosDeviceParser(options.serial, options.deviceType)
    const log = logger.createLogger('device:info')

    function manageDeviceInfo() {
      return new Promise((resolve, reject) => {
        iosDeviceParser.getDeviceData()
          .then(device => {
            let solo = wireutil.makePrivateChannel()
            const {name, platform, architect} = device

            push.send([
              wireutil.global
              , wireutil.envelope(new wire.InitializeIosDeviceState(
                options.serial
                , wireutil.toDeviceStatus('device')
                , new wire.ProviderIosMessage(
                  solo,
                  options.deviceName || device.name,
                  options.screenWsUrlPattern || ''
                )
                , new wire.IosDevicePorts(
                  options.screenPort,
                  options.connectPort
                )
                , new wire.UpdateIosDevice(
                  options.serial,
                  name,
                  platform,
                  architect
                )
              ))
            ])

            return resolve()
          })
          .catch(err => {
            return reject()
          })
      })
    }

    return {
      manageDeviceInfo
    }
  })
