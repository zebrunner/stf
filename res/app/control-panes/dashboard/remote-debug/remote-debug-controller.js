module.exports = function RemoteDebugCtrl($scope, $timeout, gettext) {
  let remoteDebugMessage = 'adb connect '
  function startRemoteConnect() {
    if ($scope.control) {
      remoteDebugMessage = $scope.device.ios ? 'wda connect ' : 'adb connect '
      $scope.control.startRemoteConnect().then(function(result) {
        var url = result.lastData
        $scope.$apply(function() {
          $scope.debugCommand = remoteDebugMessage + url
        })
      })

      return true
    }
    return false
  }

  // TODO: Remove timeout and fix control initialization
  if (!startRemoteConnect()) {
    $timeout(function() {
      if (!startRemoteConnect()) {
        $timeout(startRemoteConnect, 1000)
      }
    }, 200)
  }

  $scope.$watch('platform', function(newValue) {
    if (newValue === 'native') {
      $scope.remoteDebugTooltip =
        gettext('Run the following on your command line to debug the device from your IDE')
    } else {
      $scope.remoteDebugTooltip =
        gettext('Run the following on your command line to debug the device from your Browser')
    }

  })

  $scope.$watch('device.remoteConnectUrl', function(url) {
    $timeout(function() {
      remoteDebugMessage = $scope.device.ios ? 'wda connect ' : 'adb connect '
      $scope.debugCommand = remoteDebugMessage + url
    })
  })

}
