/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function SignInCtrl($scope, $http, CommonService) {

  $scope.error = null

  $scope.submit = function() {
    var data = {
      username: $scope.signin.username.$modelValue
      , password: $scope.signin.password.$modelValue
    }
    $scope.invalid = false
    $http.post('/auth/api/v1/zebrunner', data)
      .success(function(response) {
        $scope.error = null
        location.replace(response.redirect)
      })
      .error(function(response) {
        switch (response.error) {
          case 'ValidationError':
            $scope.error = {
              $invalid: true
            }
            break
          case 'InvalidCredentialsError':
            $scope.error = {
              $incorrect: true
            }
            break
          default:
            $scope.error = {
              $server: true
            }
            break
        }
      })
  }
}
