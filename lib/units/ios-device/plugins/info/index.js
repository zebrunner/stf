const syrup = require('stf-syrup')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')
const logger = require('../../../../util/logger')
const IosDeviceParser = require('./IosDeviceParser')

module.exports = syrup.serial()
  .dependency(require('../../support/push'))
  .define((options, push) => {
    const iosDeviceParser = new IosDeviceParser(options.serial)
    const log = logger.createLogger('device:info')

    function manageDeviceInfo() {
      iosDeviceParser.getDeviceData()
      .then((data) => {
        log.important('parse data', data)
        push.send([
          wireutil.global,
          wireutil.envelope(new wire.UpdateIosDevice(
            options.serial,
            data.name,
            data.platform,
            data.architect
          ))
        ])
      })
      .catch(err => {
        log.error(err)
      })
    }

    return {
      manageDeviceInfo
    }
  })
