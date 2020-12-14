require('./appium-remote-debug.css')

module.exports = angular.module('stf.appium-remote-debug', [

])
    .run(['$templateCache', function($templateCache) {
        $templateCache.put('control-panes/automation/appium-remote-debug/appium-remote-debug.pug',
        require('./appium-remote-debug.pug'))
    }])
    .controller('AppiumRemoteDebugCtrl', require('./appium-remote-debug-controller'))
