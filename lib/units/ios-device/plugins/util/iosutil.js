const fs = require('fs')
const iputil = require('./iputil')

var iosutil = {
  asciiparser: function(key) {
    switch (key) {
      case 'enter':
        return '\r'
      case 'del':
        return '\x08'
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
  iputil: function(serial) {
    switch (serial) {
      case '7d939448f63944da61888898b822bf863330dd9c':
        // return '192.168.0.108'
        return '192.168.88.238'
      case '6775adad13570022147ce70b6e24d709f90a0ffb':
        // return '192.168.0.103'
        return '192.168.88.118'
      case 'e998e55be50406be01801358374b1a04adc19181':
        return '192.168.88.225'
        // return '192.168.88.111'
      case '4828ca6492816ddd4996fea31c175f7ab97cbc19':
        return '192.168.88.173'
      case '2d32cbfdc42ecd8207b544d88aec33938aedb86f':
        return '192.168.88.62'
      default:
        return null
      }
  },
  getUri: function(options, port, log) {
    let url
    let ip = null
    if(options.iproxy) {
      url = `localhost:${port}`
    }
    else {
      if(this.iputil(options.serial) !== null) {
        ip = this.iputil(options.serial)
      }
      else if(options.udidStorage !== false) {
        let userFile = fs.readFileSync(options.udidStorage)
        let json = JSON.parse(userFile)
        ip = json[options.serial]
      }
      if(!ip) {
        log.error(`Device id = ${options.serial} found but not declared `)
      }
      url = `http://${ip}:${port}`
    }
    return url
  }
}

module.exports = iosutil
