module.exports = function NodeDirective() {
  return {
    restrict: 'E',
    scope: false,
    template: require('./node.pug'),
    link: function($scope, element, attrs) {
      function rendredTreeNode() {

      }
    }
  }
}
