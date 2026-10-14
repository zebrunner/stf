module.exports = angular.module('stf.socket', [
  require('stf/app-state').name
  , require('stf/common-ui/modals/temporarily-unavailable').name
])
  .factory('socket', require('./socket-service'))
