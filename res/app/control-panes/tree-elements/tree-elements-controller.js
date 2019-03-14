module.exports = function TreeElementsCntrl($scope) {
  $scope.onReset = function() {
    getTreeElements().then(function(nodes) {
      // $scope.device.tree = nodes
    })
  }

  function getTreeElements() {
    // return $scope.control.getTreeElements()
  }

  getTreeElements().then(function(nodes) {
    // $scope.device.tree = nodes
  })
}
