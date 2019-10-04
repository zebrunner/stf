module.exports = function LogsCtrl($scope, LogcatService) {

  $scope.started = LogcatService.started

  $scope.filters = {}

  var curentFilterValue = ''


  var onInstallAppListener = function(event, data) {
    $scope.$apply(function() {
      $scope.filters.levelNumbers = instAppsTolevelNumbers(data)
    })
  }

  $scope.$on('onInstallApps', onInstallAppListener)

  $scope.$on('destroy', function() {
    onInstallAppListener()
  })

  function instAppsTolevelNumbers(data) {
    return data.map((item, index) => {
      return {name: item.bundleName, number: index}
    })
  }

  LogcatService.getFilterLevels()
    .then(response => {
      // @TODO remove this peace of code
      try {
        $scope.filters.levelNumbers = instAppsTolevelNumbers(response.installedApps)
      } catch(e) {
        console.log(e)
      }

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
