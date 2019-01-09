let instance = null
const request = require('request')
class Stream {
  constructor(port, ip) {
    if(!instance) {
      instance = this
      this.url = `http://192.168.0.116:${port}`
      console.log('was started streaming on port ', port)
      this.stream = request.get(this.url)
    }

    return instance
  }

  startStream() {
    return this.stream
  }
}

module.exports = Stream
