var io = require('socket.io')

module.exports = function SocketFactory(
  $rootScope
, VersionUpdateService
, AppState
) {
  var websocketUrl = AppState.config.websocketUrl || ''

  var socket = io(websocketUrl, {
    reconnection: false, transports: ['websocket']
  })

  socket.scoped = function($scope) {
    var listeners = []

    $scope.$on('$destroy', function() {
      console.log('-- socket-service -- $destroy event')
      listeners.forEach(function(listener) {
        socket.removeListener(listener.event, listener.handler)
      })
    })

    return {
      on: function(event, handler) {
        listeners.push({
          event: event, handler: handler
        })
        socket.on(event, handler)
        return this
      }
    }
  }

  socket.on('outdated', function() {
    console.log('-- socket-service -- outdated event')
    VersionUpdateService.open()
  })

  socket.on('socket.ip', function(ip) {
    console.log('-- socket-service -- socket.ip event',ip)

    $rootScope.$apply(function() {
      socket.ip = ip
    })
  })

  return socket
}
