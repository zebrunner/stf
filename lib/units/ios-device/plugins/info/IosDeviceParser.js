const Promise = require('bluebird')

//TODO: try to remove completely moving extra details init onto the layer phase!

/**
 * Requests and provides an attached device information
 * @param {string} deviceId @description identifier e.g. 'A311989D-81CA-49C7-BB88-FDDC48376A71'
 * @param {string} deviceType @description can be 'simulator' or otherwise will be treated as 'phone'
 * @constructor
 */
const IosDeviceParser = function(deviceId, deviceType) {
  this.deviceId = deviceId

  const result = {
      "TODO: iPhone_8_Plus",
      "TODO: iPhone",
      "TODO: iOS",
      "TODO: arm64"
    }
  return result
}


module.exports = IosDeviceParser
