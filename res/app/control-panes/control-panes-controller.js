/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

module.exports =
  function ControlPanesController($scope, $http, gettext, $routeParams,
    $timeout, $location, DeviceService, GroupService, ControlService,
    StorageService, FatalMessageService, SettingsService, $route) {

    let openedModalInstance
    const sharedTabs = [
      {
        title: gettext('Screenshots'),
        icon: 'fa-camera color-skyblue',
        templateUrl: 'control-panes/screenshots/screenshots.pug',
        filters: ['native', 'web']
      },
      {
        title: gettext('Advanced'),
        icon: 'fa-bolt color-brown',
        templateUrl: 'control-panes/advanced/advanced.pug',
        filters: ['native', 'web']
      },
      {
        title: gettext('File Explorer'),
        icon: 'fa-folder-open color-blue',
        templateUrl: 'control-panes/explorer/explorer.pug',
        filters: ['native', 'web']
      },
      {
        title: gettext('Info'),
        icon: 'fa-info color-orange',
        templateUrl: 'control-panes/info/info.pug',
        filters: ['native', 'web']
      }
    ]

    $scope.topTabs = [
      {
        title: gettext('Dashboard'),
        icon: 'fa-dashboard fa-fw color-pink',
        templateUrl: 'control-panes/dashboard/dashboard.pug',
        filters: ['native', 'web']
      }
    ].concat(angular.copy(sharedTabs))

    $scope.belowTabs = [
      {
        title: gettext('Logs'),
        icon: 'fa-list-alt color-red',
        templateUrl: 'control-panes/logs/logs.pug',
        filters: ['native', 'web']
      }
    ].concat(angular.copy(sharedTabs))

    $scope.device = null
    $scope.control = null

    // TODO: Move this out to Ctrl.resolve
    function getDevice(serial) {
      DeviceService.get(serial, $scope)
        // .then(function(device) {
        //   return GroupService.invite(device)
        // })
        .then(function(device) {
          GroupService.invite(device)
          $scope.device = device
          $scope.control = ControlService.create(device, device.channel)

          // TODO: Change title, flickers too much on Chrome
          // $rootScope.pageTitle = device.name

          SettingsService.set('lastUsedDevice', serial)

          return device
        })
        .catch(function() {
          $timeout(function() {
            $location.path('/')
          })
        })
    }

    getDevice($routeParams.serial)

    $scope.$watch('device.state', (newValue, oldValue) => {
      if (newValue !== oldValue) {
        // show error message with device status, cause device was disconnected by some reason
        if (oldValue === 'using' || oldValue === 'automation') {
          openedModalInstance = FatalMessageService.open($scope.device, false)
        // close error modal if device was reconnected
        } else if ((newValue === 'using' || newValue === 'automation') && openedModalInstance) {
          openedModalInstance.dismiss(true)
          openedModalInstance = null
        // reconnect to the available device
        // TODO: refactor: use API call instead or state reloading (for now it is only working way)
        } else if (newValue === 'available' && openedModalInstance) {
          $timeout(()=> {
            if (openedModalInstance) {
              openedModalInstance.dismiss(true)
            }
            $route.reload()
          }, 0)
        }
      }
    }, true)
  }
