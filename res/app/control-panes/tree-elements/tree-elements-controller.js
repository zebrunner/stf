module.exports = function TreeElementsCntrl($scope, $rootScope) {
  var FA_CARET_RIGHT = 'fa fa-caret-right'
  var FA_CARET_DOWN = 'fa fa-caret-down'
  var HIDE_CHILD_ELEMENTS = 'hide-child-elements'
  var SHOW_CHILD_ELEMENTS = 'show-child-elements'
  var FA_FOLDER_OPEN = 'fa fa-folder-open-o'
  var FA_FOLDER_CLOSE = 'fa fa-folder-o'

  $scope.device.tree = null
  $scope.display = HIDE_CHILD_ELEMENTS
  $scope.caret = FA_CARET_RIGHT
  $scope.toggleIcon = FA_FOLDER_CLOSE

  function getTreeElements() {
    return $scope.control.getTreeElements()
  }

  $scope.refresh = function() {
    $scope.device.tree = null
    getTreeElements().then(function(response) {
      $scope.$apply(function() {
        $scope.device.tree = response.body.value
      })
    })
  }

  $rootScope.$on('expandAll', expandAllListener)
  $rootScope.$on('closeAll', closeAllListener)

  function closeAllListener() {
    hideChildEmenents()
  }

  function expandAllListener() {
    showChildElements()
  }

  $scope.toggleAll = function() {
    if($scope.toggleIcon === FA_FOLDER_CLOSE) {
      $rootScope.$broadcast('expandAll')
      $scope.toggleIcon = FA_FOLDER_OPEN
    } else {
      $rootScope.$broadcast('closeAll')
      $scope.toggleIcon = FA_FOLDER_CLOSE
    }

  }

  $scope.$on('destroy', function() {
    expandAllListener()
    closeAllListener()
  })

  $scope.toggle = function() {
    if($scope.display) {
      hideChildEmenents()
    } else {
      showChildElements()
    }
  }

  function hideChildEmenents() {
    $scope.display = HIDE_CHILD_ELEMENTS
    $scope.caret = FA_CARET_RIGHT
  }

  function showChildElements() {
    $scope.display = SHOW_CHILD_ELEMENTS
    $scope.caret = FA_CARET_DOWN
  }

  getTreeElements().then(function(response) {
    $scope.$apply(function() {
      $scope.device.tree = response.body.value
    })
  })
}
