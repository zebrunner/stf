/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import crypto from 'crypto'

import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import zebrunnerNodes from '../../../util/zebrunner-nodes.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {
  DeviceIdentity
, DevicePluginOptions
, Router
, SoloPlugin
, ZmqSocket
} from '../../../types/device-plugins.js'
import subSyrup from '../support/sub.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import identitySyrup from './util/identity.js'

export default syrup.serial()
  .dependency(subSyrup)
  .dependency(pushSyrup)
  .dependency(routerSyrup)
  .dependency(identitySyrup)
  .define(function(
    options: DevicePluginOptions
  , sub: ZmqSocket
  , push: ZmqSocket
  , router: Router
  , identity: DeviceIdentity
  ): SoloPlugin {
    var log = logger.createLogger('device:plugins:solo')

    // The channel should keep the same value between restarts, so that
    // having the client side up to date all the time is not horribly painful.
    function makeChannelId() {
      var hash = crypto.createHash('sha1')
      hash.update(options.serial)
      return hash.digest('base64')
    }

    var channel = makeChannelId()

    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)

    router.on(wire.ProbeMessage, function() {
      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceIdentityMessage(
          options.serial
        , identity.platform
        , identity.manufacturer
        , identity.operator
        , identity.model
        , identity.version
        , identity.abi
        , identity.sdk
        , new wire.DeviceDisplayMessage(identity.display)
        , new wire.DevicePhoneMessage(Object.assign({}, identity.phone))
        , identity.product
        , identity.cpuPlatform
        , identity.openGLESVersion
        , identity.marketName
        ))
      ])
    })

    // Fork (Zebrunner): the enrolled node of the container proves the registration of the device
    // with its token (STF_NODE_TOKEN), lib/util/zebrunner-nodes.ts
    var binding = zebrunnerNodes.deviceBinding(process.env.STF_NODE_TOKEN, {
      serial: options.serial
    , providerHost: options.providerHost
    , screenPort: options.screenPort
    , connectPort: options.connectPort
    })
    if (binding.warning) {
      log.warn(binding.warning)
    }

    return {
      channel: channel
    , poke: function() {
        // Fork (Zebrunner): the ports of the worker and its node for the device document, before it
        // is ready
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DevicePortsMessage(
            options.serial
          , options.screenPort
          , options.connectPort
          , binding.node
          , binding.nodeProof
          , binding.providerHost
          ))
        ])
        push.send([
          wireutil.global
        , wireutil.envelope(new wire.DeviceReadyMessage(
            options.serial
          , channel
          ))
        ])
      }
    }
  })
