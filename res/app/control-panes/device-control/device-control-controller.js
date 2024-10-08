var _ = require('lodash')

module.exports = function DeviceControlCtrl($scope, DeviceService, GroupService,
  $location, $timeout, $window, $rootScope, LogcatService, $route) {

  if ($rootScope.basicMode) {
    let scrollbarDiv = document.getElementsByClassName('pane-center fill-height ng-scope fa-pane-scroller')[0]
    scrollbarDiv.scroll(0, 0)
  }

  $scope.showScreen = true

  $scope.groupTracker = DeviceService.trackGroup($scope)

  $scope.groupDevices = $scope.groupTracker.devices

  $scope.$on('$locationChangeStart', function(event, next, current) {
    $scope.LogcatService = LogcatService
    $rootScope.LogcatService = LogcatService
  })

  $scope.goHome = function() {
    $scope.control.home()
  }

  $scope.kickDevice = function(device) {
    if (Object.keys(LogcatService.deviceEntries).includes(device.serial)) {
      LogcatService.deviceEntries[device.serial].allowClean = true
    }

    $scope.LogcatService = LogcatService
    $rootScope.LogcatService = LogcatService

    if (!device || !$scope.device) {
      alert('No device found')
      return
    }

    try {
      // If we're trying to kick current device
      if (device.serial === $scope.device.serial) {

        // If there is more than one device left
        if ($scope.groupDevices.length > 1) {

          // Control first free device first
          var firstFreeDevice = _.find($scope.groupDevices, function(dev) {
            return dev.serial !== $scope.device.serial
          })
          $scope.controlDevice(firstFreeDevice)

          // Then kick the old device
          GroupService.kick(device).then(function() {
            $scope.$digest()
          })
        } else {
          // Kick the device
          GroupService.kick(device).then(function() {
            $scope.$digest()
          })
          $location.path('/devices/')
          setTimeout(function() {
            $route.reload()
          }, 50)
        }
      } else {
        GroupService.kick(device).then(function() {
          $scope.$digest()
        })
      }
    } catch (e) {
      alert(e.message)
    }
  }

  $scope.controlDevice = function(device) {
    $location.path('/control/' + device.serial)
  }

  function isPortrait(val) {
    var value = val
    if (typeof value === 'undefined' && $scope.device) {
      value = $scope.device.display.rotation
    }
    return (value === 0 || value === 180)
  }

  function isLandscape(val) {
    var value = val
    if (typeof value === 'undefined' && $scope.device) {
      value = $scope.device.display.rotation
    }
    return (value === 90 || value === 270)
  }

  $scope.tryToRotate = function(rotation) {
    if (rotation === 'portrait') {
      $scope.control.rotate(0)
      if ($rootScope.basicMode) {
        $scope.currentRotation = 'portrait'
        return 
      }
      $timeout(function() {
        isLandscape() ? $scope.currentRotation = 'landscape' : $scope.currentRotation = 'portrait'
      }, 400)
    } else if (rotation === 'landscape') {
      $scope.control.rotate(90)
      if ($rootScope.basicMode) {
        $scope.currentRotation = 'landscape'
        return 
      }
      $timeout(function() {
        isPortrait() ? $scope.currentRotation = 'portrait' : $scope.currentRotation = 'landscape'
      }, 400)
    }
  }

  $scope.currentRotation = 'portrait'

  $scope.$watch('device.display.rotation', function(newValue) {
    if ($rootScope.basicMode) {
      return
    }

    $scope.currentRotation = 'rotating'
    if (isPortrait(newValue)) {
      $timeout(function() {
        isLandscape() ? $scope.currentRotation = 'landscape' : $scope.currentRotation = 'portrait'
      }, 400)    
    } else if (isLandscape(newValue)) {
      $timeout(function() {
        isPortrait() ? $scope.currentRotation = 'portrait' : $scope.currentRotation = 'landscape'
      }, 400)    
    }
  })

  // TODO: Refactor this inside control and server-side
  $scope.rotateLeft = function() {
    var angle = 0
    if ($scope.device && $scope.device.display) {
      angle = $scope.device.display.rotation
    }
    if (angle === 0) {
      angle = 270
    } else {
      angle -= 90
    }
    $scope.control.rotate(angle)

    if ($rootScope.standalone) {
      $window.resizeTo($window.outerHeight, $window.outerWidth)
    }
  }

  $scope.rotateRight = function() {
    var angle = 0
    if ($scope.device && $scope.device.display) {
      angle = $scope.device.display.rotation
    }
    if (angle === 270) {
      angle = 0
    } else {
      angle += 90
    }
    $scope.control.rotate(angle)

    if ($rootScope.standalone) {
      $window.resizeTo($window.outerHeight, $window.outerWidth)
    }
  }

}
