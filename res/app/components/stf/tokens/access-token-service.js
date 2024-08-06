/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function AccessTokenServiceFactory(
  $rootScope
, $http
, socket
) {
  var AccessTokenService = {}

  AccessTokenService.getAccessTokens = function() {
    return $http.get('/api/v1/user/fullAccessTokens')
  }

  AccessTokenService.generateAccessToken = function(title) {
    socket.emit('user.keys.accessToken.generate', {
      title: title
    })
  }

  AccessTokenService.removeAccessToken = function(id) {
    socket.emit('user.keys.accessToken.remove', {
      id: id
    })
  }

  socket.on('user.keys.accessToken.generated', function(token) {
    $rootScope.$broadcast('user.keys.accessTokens.generated', token)
    $rootScope.$apply()
  })

  socket.on('user.keys.accessToken.updated', function() {
    $rootScope.$broadcast('user.keys.accessTokens.updated')
    $rootScope.$apply()
  })

  return AccessTokenService
}
