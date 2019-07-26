module.exports = function() {
  return {
    restrict: 'E',
    controller: 'PreloaderController',
    template: require('./preloader.pug'),
    link: function($scope) {

    }
  }
}
