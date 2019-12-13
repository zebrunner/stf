module.exports =
  function TemporarilyUnavialableServiceFactory($uibModal, $location, $window) {
    var service = {}

    var ModalInstanceCtrl = function($scope, $uibModalInstance, message) {
      $scope.ok = function() {
        $uibModalInstance.close(true)
        $window.location.reload()
      }

      $scope.message = message

      $scope.cancel = function() {
        $uibModalInstance.dismiss('cancel')
        //document.getElementById('temporarily-unavialable').remove()
      }

      $scope.second = function() {
        $uibModalInstance.dismiss()
        $location.path('/devices/')
        //document.getElementById('temporarily-unavialable').remove()
      }

    }

    service.open = function(message) {
      const tempModal = document.getElementById('temporarily-unavialable')

      if(!tempModal) {
        var modalInstance = $uibModal.open({
          template: require('./temporarily-unavialable.pug'),
          controller: ModalInstanceCtrl,
          resolve: {
            message: function() {
              return message
            }
          }
        })

        modalInstance.result.then(function() {
        }, function() {
        })
      }
    }

    return service
  }
