import crypto from 'crypto'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import lifecycle from '../../../util/lifecycle.js'
import wireutil from '../../../wire/util.js'
import zmqcurve from '../../../util/zmqcurve.js'
import type {
  IosDeviceOptions
, IosInfoPlugin
, IosSoloPlugin
, Push
, Router
, Sub
} from '../../../types/ios-device.js'
import subSyrup from '../support/sub.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import infoSyrup from './info/index.js'

// How long the processor gets to ack the DeviceReadyMessage. Without the ack the unit is not in STF
// (a refused CURVE key is not connected again by libzmq), so it exits and the restart of its
// container is the retry, as the Android provider
var REGISTER_TIMEOUT = 15000

export default syrup.serial()
  .dependency(subSyrup)
  .dependency(pushSyrup)
  .dependency(routerSyrup)
  .dependency(infoSyrup)
  .define(function(
    options: IosDeviceOptions
  , sub: Sub
  , push: Push
  , router: Router
  , info: IosInfoPlugin
  ): IosSoloPlugin {
    var log = logger.createLogger('device:plugins:solo')
    var registerTimer: NodeJS.Timeout | undefined
    var registered = false

    function makeChannelId() {
      var hash = crypto.createHash('sha1')
      hash.update(options.serial)
      return hash.digest('base64')
    }

    var channel = makeChannelId()

    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)

    router.on(wire.DeviceRegisteredMessage, function(_channel, message) {
      if (message.serial === options.serial && !registered) {
        registered = true
        clearTimeout(registerTimer)
        log.info('Registered device "%s"', options.serial)
      }
    })

    function waitForRegistration() {
      if (registered) {
        return
      }
      clearTimeout(registerTimer)
      registerTimer = setTimeout(function() {
        log.fatal(
          'No registration ack for "%s" in %d ms: the STF processor does not get the ' +
          'messages of this unit. %s'
        , options.serial
        , REGISTER_TIMEOUT
        , zmqcurve.clientHint()
        )
        lifecycle.fatal()
      }, REGISTER_TIMEOUT)
    }

    lifecycle.observe(function() {
      clearTimeout(registerTimer)
    })

    return {
      channel: channel
    , poke: function() {
        info.manageDeviceInfo()
          .then(function() {
            Promise.delay(3 * 1000)
              .then(function() {
                push.send([
                  wireutil.global
                , wireutil.envelope(new wire.DeviceReadyMessage(
                    options.serial
                  , channel
                  ))
                ])
                waitForRegistration()
              })
          })
          .catch(function(err) {
            log.error('catch managerinfo', err)
            lifecycle.fatal(err)
          })
      }
    }
  })
