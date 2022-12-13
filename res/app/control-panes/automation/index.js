module.exports = angular.module('stf.automation', [
  require('./device-settings').name,
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put(
      'control-panes/automation/automation.pug'
      , require('./automation.pug')
    )
  }])
