require('./tree.css')

module.exports = angular.module('tree-elements', [
  require('./node/index').name,
  require('./node-control/index').name,
  require('./preloader/index').name
])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put('control-panes/tree-elements/tree.pug',
      require('./tree.pug')
    )
  }])
  .controller('TreeElementsCntrl', require('./tree-elements-controller'))

