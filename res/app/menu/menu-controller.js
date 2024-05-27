/**
* Copyright © 2019-2023 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports = function MenuCtrl(
  $scope
, $rootScope
, SettingsService
, $location
, $http
, CommonService
, LogcatService
, socket
, $cookies
, $window
, $route) {

  let contactEmail = 'support@zebrunner.com'

  SettingsService.bind($scope, {
    target: 'lastUsedDevice'
  })

  SettingsService.bind($rootScope, {
    target: 'platform',
    defaultValue: 'native',
    deviceEntries: LogcatService.deviceEntries
  })

  $scope.$on('$routeChangeSuccess', function() {
    $scope.isControlRoute = $location.path().search('/control') !== -1
  })

  $scope.mailToSupport = function() {
    CommonService.url('mailto:' + contactEmail)
  }

  $http.get('/auth/contact').then(function(response) {
    contactEmail = response.data.contact.email
  })

  $scope.logout = function() {
    const cookies = $cookies.getAll()
    for (const key in cookies) {
      if (cookies.hasOwnProperty(key)) {
        $cookies.remove(key, {path: '/'})
      }
    }
    $window.location = '/stf'
    setTimeout(function() {
      socket.disconnect()
    }, 100)
  }

  $scope.scrollToStoredPosition = function() {
    if ($route.current.$$route.originalPath === '/devices') {
      return
    }    
    $location.path('/devices/')
  }
}
