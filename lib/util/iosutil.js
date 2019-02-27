
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
  pressButton: function(key){
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
      case 'mute':
        let i
          for(i = 0; i < 25; i++) {
            this.pressButton('volumedown')
          }
          return true;
      default:
        return this.pressButton(key)
    }
  },
  swipe:function(){

  }
}

module.exports = iosutil
