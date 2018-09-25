module.exports = function InstallCtrl(
  $scope
, InstallService
) {
  $scope.accordionOpen = true
  $scope.installation = null
  $scope.bundleId = ''
  $scope.onChange = function() {
    $scope.bundleId = this.bundleId
  }
  $scope.clear = function() {
    $scope.installation = null
    $scope.accordionOpen = false
  }

  $scope.$on('installation', function(e, installation) {
    $scope.installation = installation.apply($scope)
  })

  $scope.installUrl = function(url) {
    return InstallService.installUrl($scope.control, url)
  }

  $scope.installFile = function($files) {
    if ($files.length && $scope.bundleId !== '') {
      if($scope.device && $scope.device.ios && $scope.device.ios === true) {
        return InstallService.installIosFile($scope.control, $files, $scope.device.serial, $scope.bundleId)
      } else {
        return InstallService.installFile($scope.control, $files)
      }
    }
  }

  $scope.uninstall = function(packageName) {
    // TODO: After clicking uninstall accordion opens
    return $scope.control.uninstall(packageName)
      .then(function() {
        $scope.$apply(function() {
          $scope.clear()
        })
      })
  }
}
