module.exports = function NodeDirective() {
  return {
    restrict: 'A',
    scope: false,
    controller: 'NodeCntrl',
    require: '^TreeElementsCntrl',
    template: require('./node.pug'),
    link: function($scope, element, attrs) {
      function rendredTreeNode() {

      }
    }
  }
}
