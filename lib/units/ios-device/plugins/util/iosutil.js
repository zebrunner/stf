const fs = require('fs')
const path = require('path')

let iosutil = {
  asciiparser: function(key) {
    switch (key) {
      case 'enter':
        return '\r'
      case 'del':
        return '\x08'
      case 'home':
        return null
      default:
        return key
    }
  },
  degreesToOrientation: function(degree) {
    switch (degree) {
      case 0:
        return 'PORTRAIT'
      case 90:
        return 'LANDSCAPE'
      case 180:
        return 'UIA_DEVICE_ORIENTATION_PORTRAIT_UPSIDEDOWN'
      case 270:
        return 'UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT'
    }
  },
  pressButton: function(key) {
    switch (key) {
      case 'volume_up':
        return this.pressButton('volumeup')
      case 'volume_down':
        return this.pressButton('volumedown')
      case 'power':
        return this.pressPower()
      case 'camera':
        return this.appActivate('com.apple.camera')
      case 'search':
        return this.appActivate('com.apple.mobilesafari')
      case 'home':
        return this.homeBtn()
      case 'mute': {
        let i
          for(i = 0; i < 25; i++) {
            this.pressButton('volumedown')
          }
          return true }
      default:
        return this.pressButton(key)
    }
  },
  swipe: function(orientation, params, deviceSize) {
    switch(orientation) {
      case 'PORTRAIT':
        return {
          fromX: params.fromX * deviceSize.width,
          fromY: params.fromY * deviceSize.height,
          toX: params.toX * deviceSize.width,
          toY: params.toY * deviceSize.height,
          duration: params.duration
        }
      case 'LANDSCAPE':
        return {
          toX: params.fromY * deviceSize.width,
          toY: params.fromX * deviceSize.height,
          fromX: params.toY * deviceSize.width,
          fromY: params.toX * deviceSize.height,
          duration: params.duration
        }
      default:
        return {
          fromX: params.fromX * deviceSize.width,
          fromY: params.fromY * deviceSize.height,
          toX: params.toX * deviceSize.width,
          toY: params.toY * deviceSize.height,
          duration: params.duration
        }
    }
  },
  getUri: function(options, port, log) {
    let url
    let ip = null
    if(options.iproxy) {
      url = `localhost:${port}`
    }
    else {
      let localFile = fs.readFileSync(
        path
        .dirname(require.main.filename)
        .replace('lib/cli', 'iosdevice.json'))
      let localDevices = JSON.parse(localFile)
      if(localDevices[options.serial]) {
        ({ip} = localDevices[options.serial])
      }
      else if(options.udidStorage !== false) {
        let userFile = fs.readFileSync(options.udidStorage)
        let userDevices = JSON.parse(userFile);
        ({ip} = userDevices[options.serial])
      }
      if(!ip) {
        log.error(`Device id = ${options.serial} found but not declared `)
      }
      // please don't append any url here as it used to generate wda commands
      url = `http://${ip}:${port}`
    }
    return url
  }
}

module.exports = iosutil
