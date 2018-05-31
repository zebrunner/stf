module.exports = function DeviceScreenCtrl(
  $scope
, $rootScope
, ScalingService
, InstallService
) {
  $scope.displayError = false
  $scope.ScalingService = ScalingService

  $scope.installFile = function($files) {
    console.log('screen-controller, $file :',$file)
    return InstallService.installFile($scope.control, $files)
  }
}
