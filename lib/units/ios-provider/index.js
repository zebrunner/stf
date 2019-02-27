/* eslint-disable comma-style */
const logger = require('../../util/logger')
const _ = require('lodash')
const Promise = require('bluebird')
const EventEmitter = require('eventemitter3')
const wire = require('../../wire')
const wirerouter = require('../../wire/router')
const wireutil = require('../../wire/util')
const procutil = require('../../util/procutil')
const lifecycle = require('../../util/lifecycle')
const srv = require('../../util/srv')
const zmqutil = require('../../util/zmqutil')

module.exports = function(options) {
  let iosusb = require('../../util/ios-usb')(options)
  let log = logger.createLogger('ios-provider')
  let workers = {}
  let solo = wireutil.makePrivateChannel()
  let lists = {
    all: [],
    ready: [],
    waiting: []
  }

  let totalsTimer

  let ports = options.ports.slice(
    0
    , options.ports.length - options.ports.length % 4
  )

  let delayedTotals = (function() {
    function totals() {
      if (lists.waiting.length) {
        log.info(
          'Providing %d of %d device(s); waiting for "%s"'
          , lists.ready.length
          , lists.all.length
          , lists.waiting.join('", "')
        )

        delayedTotals()
      }
      else if (lists.ready.length < lists.all.length) {
        log.info(
          'Providing all %d of %d device(s); ignoring "%s"'
          , lists.ready.length
          , lists.all.length
          , _.difference(lists.all, lists.ready).join('", "')
        )
      }
      else {
        log.info(
          'Providing all %d device(s)'
          , lists.all.length
        )
      }
    }

    return function() {
      clearTimeout(totalsTimer)
      totalsTimer = setTimeout(totals, 10000)
    }
  })()

  let push = zmqutil.socket('push')
  Promise.map(options.endpoints.push, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('ios provider sending output to "%s"', record.url)
        push.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
    .catch(function(err) {
      log.fata('Unable to connect to push endpoints', err)
    })

  let sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
    .catch(function(err) {
      log.fatal('Unable to connect to sub endpoint', err)
      lifecycle.fatal()
    })

  ;[solo].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  function filterDevice(listener) {
    return function(device) {
      return listener(device)
    }
  }

  push.send([
    wireutil.global,
    wireutil.envelope(new wire.SetAbsentDisconnectedDevices())
  ])

  let flippedTracker = new EventEmitter()

  iosusb.on('addDevice', (deviceId) => {
    let device = {
      id: deviceId,
      type: 'device',
      width: 300,
      height: 580
    }

    log.info('emit iosusb.addDevice device', device)
    options.name = 'iMac-Developer.local'
    device.type = 'device'
    let privateTracker = new EventEmitter()
    let willStop = false
    let timer, worker
    let register = new Promise(function(resolve) {
      try {
        push.send([
          wireutil.global
          , wireutil.envelope(new wire.DeviceIosIntroductionMessage(
            device.id
            , wireutil.toDeviceStatus(device.type)
            , new wire.ProviderIosMessage(
              solo
              , options.name
              , device.id
              , device.id
              , device.width
              , device.height
            )
          ))
        ])
      }
      catch(e) {
        log.error('emit addDevice with err', e)
      }
      privateTracker.once('register', resolve)
    })


    // Spawn a device worker
    function spawn() {
      let allocatedPorts = ports.splice(0, 4)
      push.send([
        wireutil.global
        , wireutil.envelope(new wire.SetIosDevicePorts(
          device.id,
          allocatedPorts[0],
          allocatedPorts[1]
        ))
      ])
      iosusb.emit(device.id, 'startWdaOnPorts', {
        streamPort: allocatedPorts[0],
        connectPort: allocatedPorts[1],
        wdaPort: allocatedPorts[2]
      })

      let proc = options.fork(device, allocatedPorts.slice())
      let resolver = Promise.defer()
      let didExit = false
      function exitListener(code, signal) {
        didExit = true
        if (signal) {
          log.warn(
            'Device worker "%s" was killed with signal %s, assuming ' +
            'deliberate action and not restarting'
            , device.id
            , signal
          )
          resolver.resolve()
        }
        else if (code === 0) {
          log.info('Device worker "%s" stopped cleanly', device.id)
          resolver.resolve()
        }
        else {
          resolver.reject(new procutil.ExitError(code))
        }
      }

      function errorListener(err) {
        log.error(
          'Device worker "%s" had an error: %s'
          , device.id
          , err.message
        )
      }

      function messageListener(message) {
        switch (message) {
          case 'ready':
            _.pull(lists.waiting, device.id)
            lists.ready.push(device.id)
            break
          default:
            log.warn(
              'Unknown message from device worker "%s": "%s"'
              , device.id
              , message
            )
            break
        }
      }

      proc.on('exit', exitListener)
      proc.on('error', errorListener)
      proc.on('message', messageListener)

      lists.waiting.push(device.id)

      return resolver.promise
        .cancellable()
        .finally(function() {
          log.info('Cleaning up device worker "%s"', device.id)

          proc.removeListener('exit', exitListener)
          proc.removeListener('error', errorListener)
          proc.removeListener('message', messageListener)

          // Return used ports to the main pool
          Array.prototype.push.apply(ports, allocatedPorts)

          // Update lists
          _.pull(lists.ready, device.id)
          _.pull(lists.waiting, device.id)
        })
        .catch(Promise.CancellationError, function() {
          if (!didExit) {
            log.info('Gracefully killing device worker "%s"', device.id)
            return procutil.gracefullyKill(proc, options.killTimeout)
          }
        })
        .catch(Promise.TimeoutError, function(err) {
          log.error(
            'Device worker "%s" did not stop in time: %s'
            , device.id
            , err.message
          )
        })
    }

    // Starts a device worker and keeps it alive
    function work() {
      return (worker = workers[device.id] = spawn())
        .then(function() {
          log.info('Device worker "%s" has retired', device.id)
          delete workers[device.id]
          worker = null
          // Tell others the device is gone

          push.send([
            wireutil.global
            , wireutil.envelope(new wire.DeviceAbsentMessage(
              device.id
            ))
          ])
        })
        .catch(procutil.ExitError, function(err) {
          if (!willStop) {
            log.error(
              'Device worker "%s" died with code %s and errr %s'
              , device.id
              , err.code
              , err
            )
            log.info('Restarting device worker "%s"', device.id)
            return Promise.delay(500)
              .then(function() {
                return work()
              })
          }
        })
    }

    // No more work required
    function stop() {
      if (worker) {
        log.info('Shutting down device worker "%s"', device.id)
        worker.cancel()
      }
    }

    // Check if we can do anything with the device
    function check() {
      clearTimeout(timer)

      if (device.present) {
        // We might get multiple status updates in rapid succession,
        // so let's wait for a while
        switch (device.type) {
          case 'device':
          case 'emulator':
            willStop = false
            timer = setTimeout(work, 100)
            break
          default:
            willStop = true
            timer = setTimeout(stop, 100)
            break
        }
      }
      else {
        willStop = true
        stop()
      }
    }

    register.then(function() {
      log.info('Registered device "%s"', device.id)
      check()
    }).catch(err => {
      log.error('failt to register deice ', err)
    })

    // Statistics
    lists.all.push(device.id)
    delayedTotals()

    // Will be set to false when the device is removed
    _.assign(device, {
      present: true
    })

    // When any event occurs on the added device
    function deviceListener(type, updatedDevice) {
      // Okay, this is a bit unnecessary but it allows us to get rid of an
      // ugly switch statement and return to the original style.
      privateTracker.emit(type, updatedDevice)
    }

    // When the added device changes
    function changeListener(updatedDevice) {
      register.then(function() {
        log.info(
          'Device "%s" is now "%s" (was "%s")'
          , device.id
          , updatedDevice.type
          , device.type
        )

        _.assign(device, {
          type: updatedDevice.type
        })

        // Tell others the device changed
        push.send([
          wireutil.global
          , wireutil.envelope(new wire.DeviceStatusMessage(
            device.id
            , wireutil.toDeviceStatus(device.type)
          ))
        ])

        check()
      })
    }

    // When the added device gets removed
    function removeListener(deviceId) {
      register.then(function() {
        log.info('Lost device "%s" (%s)', device.id, device.type)

        if(deviceId === device.id) {
          clearTimeout(timer)
          flippedTracker.removeListener(device.id, deviceListener)
          _.pull(lists.all, device.id)
          delayedTotals()
          // Tell others the device is gone
          push.send([
            wireutil.global
            , wireutil.envelope(new wire.DeviceAbsentMessage(
              device.id
            ))
          ])

          _.assign(device, {
            present: false
          })

          check()
        }
      })
    }

    iosusb.on('remove', filterDevice(function(device) {
      flippedTracker.emit(device.id, 'remove', device)
      removeListener(device.id)
      if(workers[device.id]) {
        workers[device.id].cancel()
        delete workers[device.id]
        worker = null
      }
    }))

    flippedTracker.on(device.id, deviceListener)
  })

  sub.on('message', wirerouter()
    .on(wire.DeviceRegisteredMessage, function(channel, message) {
      flippedTracker.emit(message.serial, 'register')
    })
    .handler())
}
