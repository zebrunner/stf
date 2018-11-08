
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
  }
}



module.exports = iosutil
