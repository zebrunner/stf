/**
* Copyright © 2019 code initially contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/
module.exports = function DateFormatCtrl(
  $scope
, SettingsService
) {
  $scope.defaultDateFormat = 'M/d/yy h:mm:ss a'
  SettingsService.bind($scope, {
    target: 'dateFormat'
  , source: 'dateFormat'
  , defaultValue: $scope.defaultDateFormat
  })
  
  $scope.validateInput = function(event) {
    const validChars = 'dmy/:has '
    const key = String.fromCharCode(event.which || event.keyCode)
    if (!validChars.includes(key)) {
      event.preventDefault()
    }
  }

  $scope.$watch(
    function() {
      return SettingsService.get('dateFormat')
    }
  , function(newvalue) {
      if (typeof newvalue === 'undefined') {
        SettingsService.set('dateFormat', $scope.defaultDateFormat)
      }
    }
  )
}