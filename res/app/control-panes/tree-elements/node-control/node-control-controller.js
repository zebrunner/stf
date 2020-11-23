module.exports = function NodeControlController($scope, $rootScope) {
  $rootScope.$on('selectElement', selectElementListener)
  $scope.node = null
  var elementRect = null

  function selectElementListener(type, data) {
    $scope.node = data
    elementRect = $scope.node.rect
  }

  $scope.$on('destroy', function() {
    selectElementListener()
  })

  $scope.tapElement = function() {
    if($scope.node.label) {
      $scope.control.tapDeviceTreeElement($scope.node.label)
    }
  }
}
