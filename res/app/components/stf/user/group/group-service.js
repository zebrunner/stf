var Promise = require('bluebird')

module.exports = function GroupServiceFactory(
  socket
, TransactionService
, TransactionError
) {
  var groupService = {
  }

  groupService.invite = function(device) {
    console.log('group service invite device: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
    if (!true) {
      return Promise.reject(new Error('Device is not usable'))
    }

    var tx = TransactionService.create(device)
    console.log('group service invite device2: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
    socket.emit('group.invite', device.channel, tx.channel, {
      requirements: {
        serial: {
          value: device.serial
        , match: 'exact'
        }
      }
    })
    return tx.promise
      .then(function(result) {
        console.log('group service invite device3: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
        return result.device
      })
      .catch(TransactionError, function() {
        console.log('group service invite device4: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
        throw new Error('Device refused to join the group')
      })
  }

  groupService.kick = function(device, force) {
    console.log('group service kick device: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
    if (!force && !device.usable) {
      return Promise.reject(new Error('Device is not usable'))
    }

    var tx = TransactionService.create(device)
    console.log('group service kick device2: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
    socket.emit('group.kick', device.channel, tx.channel, {
      requirements: {
        serial: {
          value: device.serial
        , match: 'exact'
        }
      }
    })
    return tx.promise
      .then(function(result) {
        console.log('group service kick device3: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
        return result.device
      })
      .catch(TransactionError, function() {
        console.log('group service kick device4: ', device.model, '; using: ', device.using, '; usable: ', device.usable)
        throw new Error('Device refused to join the group')
      })
  }

  return groupService
}
