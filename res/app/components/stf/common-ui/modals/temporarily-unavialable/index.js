module.exports = angular.module('stf.temporarily-unavialable', [
  require('stf/common-ui/modals/common').name
])
  .factory('TemporarilyUnavialableService', require('./temporarily-unavialable-service'))
