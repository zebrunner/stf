
module.exports = angular.module('node', [])
  .controller('NodeContrl', require('./node-controller'))
  .directive('nodeDirective', require('./node-directive'))
