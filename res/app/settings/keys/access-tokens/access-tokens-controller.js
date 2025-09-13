/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function AccessTokensCtrl($scope, AccessTokenService) {

    $scope.accessTokens = []
    $scope.newToken = null

    function updateTokens() {
      AccessTokenService.getAccessTokens()
        .then(function(response) {
          $scope.accessTokenTitles = response.data.titles || []
        })
    }

    $scope.removeToken = function(id) {
      AccessTokenService.removeAccessToken(id)
    }

    $scope.closeGenerated = function() {
      $scope.showGenerated = false
      $scope.newToken = null
      updateTokens()
    }

    $scope.$on('user.keys.accessTokens.generated', function(event, token) {
      $scope.newToken = token
      $scope.showGenerated = true
    })
    $scope.$on('user.keys.accessTokens.updated', updateTokens)
    updateTokens()
}