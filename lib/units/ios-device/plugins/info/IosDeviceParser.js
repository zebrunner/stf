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

  this.AccessStrategy = IosDeploy
  if (deviceType === 'simulator') {
    this.AccessStrategy = XcrunSimCtl
  }

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
const IosDeploy = function(deviceId) {
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

    if (matchData[1]) {
      return matchData[1].split(', ')
    }
    return []
  }
}

/**
 * Call xcrun simctl to fetch device info the device is available
 * @param {string} deviceId @description identifier e.g. 'A311989D-81CA-49C7-BB88-FDDC48376A71'
 * @constructor
 */
const XcrunSimCtl = function(deviceId) {
  this._udid = deviceId
}

/**
 * Getting device info
 * @return {Promise<{name, type, platform, architect}>} @description device info
 */
XcrunSimCtl.prototype.getDeviceData = async function() {
  const output = await this._fetchDeviceData()
  return this._processOutput(output)
}

/**
 * Fetch data about devices
 * @return {Promise<object>} @description output
 * @private
 */
XcrunSimCtl.prototype._fetchDeviceData = function() {
  const xcrunProcess = spawn('xcrun', ['simctl', 'list', '--json'])

  return new Promise((resolve, reject) => {
      xcrunProcess.on('error', (err) => {
        reject(err)
      })

      let output = ''
      xcrunProcess.stdout.on('data', (data) => {
        output += data.toString()
      })

      xcrunProcess.on('close', code => {
        if(code !== 0) {
          reject(new Error(`xcrun process was closed with code : ${code}`))
        }

        if (!output.includes(this._udid)) {
          reject(new Error(`Given identifier ${this._udid} is not found in xcrun output!`))
        }

        const json = JSON.parse(output)
        if (!json.devices || !json.runtimes) {
          reject(new Error('Wrong output from xcrun!'))
        }

        resolve(json)
      })
    }
  )
}

/**
 * Process output of xcrun
 * @param {{devices: {}, runtimes: {name: string, identifier: string, version: string}[]}} output @description output
 * @private
 * @return {{name, type, platform, architect}} @description device info
 */
XcrunSimCtl.prototype._processOutput = function(output) {
  const result = {
    name: null,
    type: null,
    platform: null,
    architect: '-', //TODO: have no idea where to get the architect for simulators, it supposed to be the same or compatible one as the host machine has
  }

  let targetDevice = null
  for (const [groupName, group] of Object.entries(output.devices)) {
    targetDevice = group.find(entry => entry.udid === this._udid)

    if (targetDevice && targetDevice.isAvailable && targetDevice.state === 'Booted') {
      result.name = targetDevice.name

      const osData = output.runtimes.find(r => r.identifier === groupName)

      if (osData) {
        result.platform = osData.name.replace(/^([^\s]+)?.*/, '$1')
      }

      break
    }
  }

  if (!targetDevice) {
    throw new Error(`Device ${this._udid} is not found as booted!`)
  }

  return result
}


module.exports = IosDeviceParser
