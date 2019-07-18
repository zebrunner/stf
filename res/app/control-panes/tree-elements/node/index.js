require('./node.css')

module.exports = angular.module('node', [], function($rootScopeProvider) {
    $rootScopeProvider.digestTtl(25)
  })
  .run(['$templateCache', function($templateCache) {
    $templateCache.put('control-panes/tree-elements/node/node.pug',
      require('./node.pug')
    )
  }])
  .controller('NodeCntrl', require('./node-controller'))
  .directive('nodeElement', require('./node-directive'))
