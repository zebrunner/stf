
module.exports = angular.module('tree-elements', [])
  .controller('TreeElementsCntrl', require('./tree-elements-controller'))
  .directive('treeElements', require('./tree-elements-directive.js'))
