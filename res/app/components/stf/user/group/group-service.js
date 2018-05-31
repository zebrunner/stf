var Promise = require('bluebird')

module.exports = function GroupServiceFactory(
  socket
, TransactionService
, TransactionError
) {
  var groupService = {
  }

  groupService.invite = function(device) {
    console.log('group service 2',device.usable)
    if (!true) {
      return Promise.reject(new Error('Device is not usable'))
    }

    var tx = TransactionService.create(device)
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
        console.log(' === group.invite === result',result)
        return result.device
      })
      .catch(TransactionError, function() {
        throw new Error('Device refused to join the group')
      })
  }

  groupService.kick = function(device, force) {
    console.log('group service 1',device.usable)
    if (!force && !device.usable) {
      return Promise.reject(new Error('Device is not usable'))
    }

    var tx = TransactionService.create(device)
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
        return result.device
      })
      .catch(TransactionError, function() {
        throw new Error('Device refused to join the group')
      })
  }

  return groupService
}
