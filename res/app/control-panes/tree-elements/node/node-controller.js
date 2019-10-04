module.exports = function NodeController($scope, $rootScope) {
  var FA_CARET_RIGHT = 'fa fa-caret-right'
  var FA_CARET_DOWN = 'fa fa-caret-down'
  var HIDE_CHILD_ELEMENTS = 'hide-child-elements'
  var SHOW_CHILD_ELEMENTS = 'show-child-elements'

  $scope.display = HIDE_CHILD_ELEMENTS
  $scope.caret = FA_CARET_RIGHT

  $scope.toggle = function() {
    if($scope.display === SHOW_CHILD_ELEMENTS) {
      hideChildEmenents()
    } else {
      showChildElements()
    }
  }

  $scope.selectNode = function($event) {
    $rootScope.$emit('selectElement', $scope.node)
    $event.stopPropagation()
    $event.preventDefault()
  }

  $rootScope.$on('expandAll', expandAllListener)
  $rootScope.$on('closeAll', closeAllListener)

  $scope.$on('destroy', function() {
    expandAllListener()
    closeAllListener()
  })

  function expandAllListener() {
    showChildElements()
  }

  function closeAllListener() {
    hideChildEmenents()
  }

  function hideChildEmenents() {
    $scope.display = HIDE_CHILD_ELEMENTS
    $scope.caret = FA_CARET_RIGHT
  }

  function showChildElements() {
    $scope.display = SHOW_CHILD_ELEMENTS
    $scope.caret = FA_CARET_DOWN
  }
}
