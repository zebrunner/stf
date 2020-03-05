const {spawn} = require('child_process')
const Promise = require('bluebird')

const IosDeviceParser = function(deviceId) {
  const deviceNameRegExp = new RegExp('\'(.*)\'')
  const deviceInfoRegExp = new RegExp(/\((.*)\)/m)
  this.parsedData = null
  this.deviceId = deviceId

  const getDeviceDataById = (deviceId) => {
    const defaultArgs = ['-c']
    const iosDeployProcess = spawn('ios-deploy', defaultArgs)

    return new Promise((resolve, reject) => {
      iosDeployProcess.stdout.on('data', (data) => {
        let output = data.toString()

        if (output.includes(deviceId)) {
          this.parsedData = output
          resolve(output)
        }
      })

      iosDeployProcess.on('close', (code) => {
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
    const [, type, platform, architect] = parseDeviceInfo()
    const name = parseName()

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

    if(matchData[1]) {
      return matchData[1].split(', ')
    }
    return []
  }
}

module.exports = IosDeviceParser
