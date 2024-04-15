module.exports = function InputCtrl($scope) {

  let muteButton = document.getElementById('muteButton')

  muteButton.onclick = function() {
    if (muteButton.getAttribute('disabled')) {
      return
    }

    $scope.control.keyPress('mute')
    muteButton.setAttribute('disabled', 'disabled')
    muteButton.setAttribute('style', 'cursor: wait;')    

    setTimeout(function() {
      muteButton.removeAttribute('disabled')
      muteButton.setAttribute('style', 'cursor: pointer;')
    }, 16000)
  } 

  $scope.press = function(key) {
    $scope.control.keyPress(key)
  }
}
