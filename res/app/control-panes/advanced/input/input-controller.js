module.exports = function InputCtrl($scope) {

  $scope.press = function(key) {
    console.log('output current device !',$scope.device.deivce)
    $scope.control.keyPress(key)
  }
}
