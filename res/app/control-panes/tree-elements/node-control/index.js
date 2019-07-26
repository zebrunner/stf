require('./node-control.css')

module.exports = angular.module('node-control', [])
  .run(['$templateCache', function($templateCatche) {
    $templateCatche.put(
      'control-panes/tree-elements/node-control/node-control.pug',
      require('./node-control.pug')
      )
  }])
  .controller('NodeControlCntrl', require('./node-control-controller'))
