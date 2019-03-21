module.exports = function TreeElementsDirective() {
  return {
    restrict: 'A',
    controller: 'TreeElementsCntrl',
    template: require('./tree.pug'),
    link: function(scope, element, attrs) {
      function renderTree() {

      }

    }
  }
}
