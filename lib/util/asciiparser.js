module.exports = function(key) {
  switch (key) {
    case 'enter':
      return '\r'
    case 'del':
      return '\x08'
    case 'dpad_left':
      return '\37'
    default:
      return key
  }
}
