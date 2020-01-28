module.exports = function AppiumRemoteDebugCtrl($scope, $timeout) {
    $scope.appiumUrl = ''

    $scope.$watch('device.remoteConnectUrl', function(value) {
        $timeout(function() {
            $scope.appiumUrl = value
        })
    })
}
