let instance = null
const request = require('request')
class Stream {
  constructor(url) {
    if(!instance) {
      instance = this
      this.url = url
      this.stream = request.get(this.url)
    }

    return instance
  }

  getStream() {
    return this.stream
  }

  setNewStream() {
    this.stream = null
    delete this.stream
    this.stream = request.get(this.url)
  }
}

module.exports = Stream
