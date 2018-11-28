module.exports = function LogsCtrl($scope, LogcatService) {

  $scope.started = LogcatService.started

  $scope.filters = {}

  var curentFilterValue = ''

  LogcatService.getFilterLevels()
    .then(response => {
      $scope.filters.levelNumbers = response.installedApps.map((item, index) => {
        return {name: item.bundleName, number: index}
      })
    })
    .catch(err => {
      $scope.filters.levelNumbers = LogcatService.filters.levelNumbers
    })

  LogcatService.filters.filterLines()

  $scope.$watch('started', function(newValue, oldValue) {
    if (newValue !== oldValue) {
      LogcatService.started = newValue
      if (newValue) {
        $scope.control.startLogcat([curentFilterValue]).then(function() {
        })
      } else {
        $scope.control.stopLogcat()
      }
    }
  })
  window.onbeforeunload = function() {
    if ($scope.control) {
      $scope.control.stopLogcat()
    }
  }

  $scope.clear = function() {
    LogcatService.clear()
  }

  function defineFilterWatchers(props) {
    angular.forEach(props, function(prop) {
      $scope.$watch('filters.' + prop, function(newValue, oldValue) {
        if (!angular.equals(newValue, oldValue)) {
          curentFilterValue = newValue.name
          LogcatService.filters[prop] = newValue
        }
      })
    })
  }

  defineFilterWatchers([
    'levelNumber',
    'message',
    'pid',
    'tid',
    'dateLabel',
    'date',
    'tag',
    'priority'
  ])
}
