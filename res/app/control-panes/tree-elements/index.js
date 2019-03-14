
module.exports = angular.module('tree-elements', [])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put('control-panes/tree-elements/tree.pug',
      require('./tree.pug')
    )
  }])
  .controller(
    'TreeElementsCntrl',
    require('./tree-elements-controller'))
  .directive('treeElements', require('./tree-elements-directive.js'))
