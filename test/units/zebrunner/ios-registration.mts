// Fork (Zebrunner): the registration of the ios-device unit, lib/units/ios-device/plugins/solo.ts. A unit
// whose messages did not reach the processor (its CURVE key refused: libzmq does not connect again)
// stayed up and absent from STF; it waits for the ack of its DeviceReadyMessage now and exits without it
import Bluebird from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'
import sinon from 'sinon'

import lifecycle from '../../../lib/util/lifecycle.js'
import logger from '../../../lib/util/logger.js'
import zmqcurve from '../../../lib/util/zmqcurve.js'
import wire from '../../../lib/wire/index.js'
import wirerouter from '../../../lib/wire/router.js'
import wireutil from '../../../lib/wire/util.js'
import type {IosSoloPlugin} from '../../../lib/types/ios-device.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)
var SERIAL = 'udid-1'

function module(file: string) {
  return new URL(file, lib)
}

describe('zebrunner: ios-device registration', function() {
  var clock: sinon.SinonFakeTimers
    , router: ReturnType<typeof wirerouter>
    , pushed: Buffer[][]
    , fatal: sinon.SinonStub
    , entries: Array<{priority: number, message: string}>
    , solo: IosSoloPlugin

  function onEntry(entry: logger.Entry) {
    if (entry.tag === 'device:plugins:solo') {
      entries.push({priority: entry.priority, message: entry.message})
    }
  }

  function messages(priority: number) {
    return entries
      .filter(function(entry) {
        return entry.priority === priority
      })
      .map(function(entry) {
        return entry.message
      })
  }

  async function settle() {
    for (var i = 0; i < 5; i++) {
      await new Promise(function(resolve) {
        setImmediate(resolve)
      })
    }
  }

  // poke: the DeviceReadyMessage, sent 3 s after the info of the device
  async function poke() {
    solo.poke()
    await settle()
    await clock.tickAsync(3000)
    await settle()
    var ready = pushed.map(function(message) {
      return wire.Envelope.decode(message[1]!)
    }).filter(function(envelope) {
      return envelope.type === wire.MessageType.DeviceReadyMessage
    })
    expect(ready).to.have.length(1)
  }

  beforeEach(async function() {
    router = wirerouter()
    pushed = []
    entries = []
    clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    fatal = sinon.stub(lifecycle, 'fatal')
    sinon.stub(lifecycle, 'observe')
    sinon.stub(zmqcurve, 'clientHint').returns('Check that the ZeroMQ server lets this host in.')
    sinon.stub(console, 'error')
    logger.on('entry', onEntry)

    var restores = [
      mockModule(module('units/ios-device/support/push.js'), {
        default: syrup.serial().define(function() {
          return {
            send: function(message: Buffer[]) {
              pushed.push(message)
            }
          }
        })
      })
    , mockModule(module('units/ios-device/support/sub.js'), {
        default: syrup.serial().define(function() {
          return {
            subscribe: function() {}
          }
        })
      })
    , mockModule(module('units/ios-device/support/router.js'), {
        default: syrup.serial().define(function() {
          return router
        })
      })
    , mockModule(module('units/ios-device/plugins/info/index.js'), {
        default: syrup.serial().define(function() {
          return {
            manageDeviceInfo: function() {
              return Bluebird.resolve()
            }
          }
        })
      })
    ]
    try {
      var plugin = (await importFresh(module('units/ios-device/plugins/solo.js'))).default
      solo = await plugin.consume({serial: SERIAL})
    }
    finally {
      restores.forEach(function(restore) {
        restore()
      })
    }
  })

  afterEach(function() {
    logger.removeListener('entry', onEntry)
    clock.restore()
    sinon.restore()
  })

  it('should exit with what to check when no registration ack comes', async function() {
    await poke()
    // the ack of another device is not the one of this unit
    router.handler()(solo.channel, wireutil.envelope(new wire.DeviceRegisteredMessage('other')))

    await clock.tickAsync(14999)
    expect(fatal.called).to.equal(false)
    await clock.tickAsync(1)
    expect(fatal.calledOnce).to.equal(true)
    expect(messages(logger.Level.FATAL)).to.deep.equal([
      `No registration ack for "${SERIAL}" in 15000 ms: the STF processor does not get the ` +
      'messages of this unit. Check that the ZeroMQ server lets this host in.'
    ])
  })

  it('should keep running once the processor acks the device', async function() {
    await poke()
    await clock.tickAsync(1000)
    router.handler()(solo.channel, wireutil.envelope(new wire.DeviceRegisteredMessage(SERIAL)))
    await clock.tickAsync(60000)

    expect(fatal.called).to.equal(false)
    expect(messages(logger.Level.INFO)).to.include(`Registered device "${SERIAL}"`)
    expect(messages(logger.Level.FATAL)).to.deep.equal([])
  })
})
