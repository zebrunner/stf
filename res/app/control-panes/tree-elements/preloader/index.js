require('./preloader.css')

module.exports = angular.module('tree-preloader', [])
  .run(['$templateCache', function($templateCache) {
    $templateCache.put('control-panes/tree-elements/preloader/preloader.pug',
      require('./preloader.pug'))
  }])
  .controller('PreloaderController', require('./preloader-controller'))
  .directive('treePreloader', require('./preloader-directive'))
