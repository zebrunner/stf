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
        return 'volumeup'
      case 'volume_down':
        return 'volumedown'
      case 'mute':
        return 'volumedown'
      case 'home':
        return 'home'

      default:
        return key
    }
  },
  appActivate: function(key){
    switch (key) {
      case 'camera':
        return 'com.apple.camera'
      case 'search':
        return 'com.apple.mobilesafari'
    }
  }
}



module.exports = iosutil
