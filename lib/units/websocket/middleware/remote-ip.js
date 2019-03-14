var proxyaddr = require('proxy-addr')

module.exports = function(options) {
  return function(socket, next) {
    var req = socket.request

    req.ip = proxyaddr(req, options.trust)
    console.log('Websocket service remote-ip, req.ip', req.ip)
    next()
  }
}
