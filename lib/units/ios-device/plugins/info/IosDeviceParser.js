var logger = require('../../../../util/logger')
const {spawn} = require('child_process')
const Promise = require('bluebird')

/**
 * Requests and provides an attached device information
 * @param {string} deviceId @description identifier e.g. 'A311989D-81CA-49C7-BB88-FDDC48376A71'
 * @param {string} deviceType @description can be 'simulator' or otherwise will be treated as 'phone'
 * @constructor
 */
const IosDeviceParser = function(deviceId, deviceType) {
  this.deviceId = deviceId

  this.AccessStrategy = IosWda
  this.accesor = null

  this.getDeviceData = () => {
    if (!this.accesor) {
      this.accesor = new this.AccessStrategy(this.deviceId)
    }

    return this.accesor.getDeviceData()
  }
}

/**
 * Call ios-deploy to fetch device info the device is found
 * @param {string} deviceId @description identifier e.g. 'A311989D-81CA-49C7-BB88-FDDC48376A71'
 * @constructor
 */
const IosWda = function(deviceId) {
  var log = logger.createLogger('IosDeviceParser')

  const deviceNameRegExp = new RegExp('\'(.*)\'')
  const deviceInfoRegExp = new RegExp(/\((.*)\)/m)
  this.parsedData = null
  this.deviceId = deviceId

  const getDeviceDataById = (deviceId) => {
    const defaultArgs = ['http://192.168.88.155:20011/wda/device/info']
    const iosWdaProcess = spawn('curl', defaultArgs)

    return new Promise((resolve, reject) => {
      iosWdaProcess.stdout.on('data', (data) => {
        let output = data.toString()

        log.info('curl /wda/device/info output', output)

        if (output.includes(deviceId)) {
          this.parsedData = output
          resolve(output)
        }
      })

      iosWdaProcess.on('close', (code) => {
        reject(new Error(`Process closed with code : ${code}`))
      })
    })
  }

  this.getDeviceData = () => {
    return new Promise((resolve, reject) => {
      getDeviceDataById(this.deviceId)
        .then((data) => {
          if (data) {
            resolve(getParsedData())
          }
          else {
            reject(new Error(`Cannot find device with given id : ${this.deviceId}`))
          }
        })
        .catch(err => {
          reject(err)
        })
    })
  }

  const getParsedData = () => {
    name = "TODO: STAG_iPhone_8_Plus"
    type = "iPhone"
    platform = "iOS"
    architect = "amd64"

    return {
      name,
      type,
      platform,
      architect
    }
  }

  const parseName = () => {
    const matchData = this.parsedData.match(deviceNameRegExp)

    if (matchData[1]) {
      return matchData[1]
    }
    return null
  }

  const parseDeviceInfo = () => {
    const matchData = this.parsedData.match(deviceInfoRegExp)

    if (matchData[1]) {
      return matchData[1].split(', ')
    }
    return []
  }
}

module.exports = IosDeviceParser
