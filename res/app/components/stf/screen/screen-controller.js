module.exports = function DeviceScreenCtrl(
  $scope
, $rootScope
, ScalingService
, InstallService
) {
  $scope.displayError = false
  $scope.ScalingService = ScalingService

  $scope.installFile = function($files) {
    if($scope.device && $scope.device.ios && $scope.device.ios === true) {
      InstallService.installIosFile($scope.control, $files, $scope.device.serial)
    } else {
      return InstallService.installFile($scope.control, $files)
    }
  }
}
