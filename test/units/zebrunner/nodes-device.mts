// Fork (Zebrunner): the node proof the device units of an enrolled node send with the registration
// of a device (STF_NODE_TOKEN, lib/util/zebrunner-nodes.ts), Android and iOS; the host of the
// provider its workers get is tested with the ports, test/units/zebrunner/device-ports.mts
import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'
import sinon from 'sinon'

import zebrunnerNodes from '../../../lib/util/zebrunner-nodes.js'
import wire from '../../../lib/wire/index.js'
import wirerouter from '../../../lib/wire/router.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)
var TOKEN = zebrunnerNodes.generateNodeToken('node-1')

function module(file: string) {
  return new URL(file, lib)
}

function withNodeToken<T>(token: string | null, fn: () => Promise<T>): Promise<T> {
  var saved = process.env.STF_NODE_TOKEN
  if (token === null) {
    delete process.env.STF_NODE_TOKEN
  }
  else {
    process.env.STF_NODE_TOKEN = token
  }
  return fn().finally(function() {
    if (typeof saved === 'undefined') {
      delete process.env.STF_NODE_TOKEN
    }
    else {
      process.env.STF_NODE_TOKEN = saved
    }
  })
}

function pushMock(pushed: Buffer[][]) {
  return {
    default: syrup.serial().define(function() {
      return {
        send: function(message: Buffer[]) {
          pushed.push(message)
        }
      }
    })
  }
}

function decoded(pushed: Buffer[][]) {
  return pushed.map(function(message) {
    return wire.Envelope.decode(message[1]!)
  })
}

describe('zebrunner: node proof of the device units', function() {
  afterEach(function() {
    sinon.restore()
  })

  describe('Android device worker', function() {
    async function ports(token: string | null, providerHost?: string) {
      var pushed: Buffer[][] = []
      var restores = [
        mockModule(module('units/device/support/push.js'), pushMock(pushed))
      , mockModule(module('units/device/support/sub.js'), {
          default: syrup.serial().define(function() {
            return {subscribe: function() {}}
          })
        })
      , mockModule(module('units/device/support/router.js'), {
          default: syrup.serial().define(function() {
            return wirerouter()
          })
        })
      , mockModule(module('units/device/plugins/util/identity.js'), {
          default: syrup.serial().define(function() {
            return {}
          })
        })
      ]
      var solo: {poke(): void} | null = null
      try {
        await withNodeToken(token, async function() {
          var plugin = (await importFresh(module('units/device/plugins/solo.js'))).default
          solo = await plugin.consume({
            serial: 'serial1', screenPort: 7404, connectPort: 7405, providerHost: providerHost
          })
        })
      }
      finally {
        restores.forEach(function(restore) {
          restore()
        })
      }
      solo!.poke()
      var envelope = decoded(pushed)[0]!
      expect(envelope.type).to.equal(wire.MessageType.DevicePortsMessage)
      return wire.DevicePortsMessage.decode(envelope.message)
    }

    it('should prove its registration with the node token', async function() {
      var message = await ports(TOKEN, '10.0.0.5')
      expect(message.node).to.equal('node-1')
      expect(message.providerHost).to.equal('10.0.0.5')
      expect(message.nodeProof).to.equal(zebrunnerNodes.nodeProof(TOKEN, {
        serial: 'serial1', providerHost: '10.0.0.5', screenPort: 7404, connectPort: 7405
      }))
      expect(zebrunnerNodes.verifyNodeProof(zebrunnerNodes.sha256(TOKEN), message.nodeProof, {
        serial: 'serial1', providerHost: '10.0.0.5', screenPort: 7404, connectPort: 7405
      })).to.equal(true)
      expect(JSON.stringify(message)).to.not.include(TOKEN.split('.')[2])
    })

    it('should send the host without a node token, and no proof', async function() {
      var message = await ports(null, '10.0.0.5')
      expect([message.node, message.nodeProof, message.providerHost])
        .to.eql([null, null, '10.0.0.5'])
    })

    it('should not prove anything with a token that is not a node token', async function() {
      var message = await ports('some-shared-secret', '10.0.0.5')
      expect([message.node, message.nodeProof]).to.eql([null, null])
    })
  })

  describe('iOS device unit', function() {
    it('should prove its registration with the node token', async function() {
      var pushed: Buffer[][] = []
      var restores = [
        mockModule(module('units/ios-device/support/push.js'), pushMock(pushed))
        // go-ios never answers: only the registration is sent
      , mockModule(module('units/ios-device/plugins/util/goios.js'), {
          IosNetworkCollector: function() {}
        , execGoIos: function() {
            return new Promise(function() {})
          }
        , ostraceEntry: function() {}
        , parseBattery: function() {}
        , parseDeviceInfo: function() {}
        , parseDiskSpace: function() {}
        , spawnGoIos: function() {}
        })
      ]
      var info: {manageDeviceInfo(): Promise<void>} | null = null
      try {
        await withNodeToken(TOKEN, async function() {
          var plugin = (await importFresh(module('units/ios-device/plugins/info/index.js'))).default
          info = await plugin.consume({
            serial: '00008030-TEST'
          , provider: 'mcloud'
          , deviceName: 'My Phone'
          , screenWsUrlPattern: 'wss://stf/d/10.0.0.5/00008030-TEST/7404/'
          , screenPort: 7404
          , connectPort: 8101
          , host: '10.0.0.5'
          })
          await info!.manageDeviceInfo()
        })
      }
      finally {
        restores.forEach(function(restore) {
          restore()
        })
      }
      var envelope = decoded(pushed)[0]!
      expect(envelope.type).to.equal(wire.MessageType.InitializeIosDeviceState)
      var message = wire.InitializeIosDeviceState.decode(envelope.message)
      expect(message.node).to.equal('node-1')
      expect(message.providerHost).to.equal('10.0.0.5')
      expect(message.nodeProof).to.equal(zebrunnerNodes.nodeProof(TOKEN, {
        serial: '00008030-TEST', providerHost: '10.0.0.5', screenPort: 7404, connectPort: 8101
      }))
    })
  })
})
