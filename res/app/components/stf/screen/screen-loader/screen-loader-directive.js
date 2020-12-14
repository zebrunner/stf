module.exports = function screenLoaderDirective() {
  return {
    restrict: 'E',
    template: require('./screen-loader.pug'),
    link: function(scope, element) {
      const hideScreenLoaderListener = scope.$on('hide-screen-loader', function() {
        hideScreenLoaderListener()
        element.remove()
      })

      scope.$on('destroy', function() {
        hideScreenLoaderListener()
      })
    }
  }
}
