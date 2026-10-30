// Fork (Zebrunner): the registration of a device by the provider, lib/units/provider/index.ts. The totals
// gave the device up ("Providing all 0 of 1") while its registration was pending, and a missing ack
// was ignored after 15 s although the processor did not get the messages of the provider
import {EventEmitter} from 'node:events'

import Promise from 'bluebird'
import {expect} from 'chai'
import sinon from 'sinon'

import lifecycle from '../../../lib/util/lifecycle.js'
import logger from '../../../lib/util/logger.js'
import zmqcurve from '../../../lib/util/zmqcurve.js'
import zmqutil from '../../../lib/util/zmqutil.js'
import wire from '../../../lib/wire/index.js'
import wireutil from '../../../lib/wire/util.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)

interface FakeSocket {
  type: string
  sent: Buffer[][]
  listeners: Array<(channel: Buffer, data: Buffer) => void>
}

describe('zebrunner: provider registration', function() {
  var clock: sinon.SinonFakeTimers
    , tracker: EventEmitter
    , sockets: FakeSocket[]
    , observers: Array<() => unknown>
    , fatal: sinon.SinonStub
    , entries: Array<{priority: number, message: string}>
    , restoreAdb: () => void

  function onEntry(entry: {priority: number, message: string, tag: string}) {
    if (entry.tag === 'provider') {
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

  function socket(type: string) {
    return sockets.find(function(sock) {
      return sock.type === type
    })!
  }

  // The ack of the processor, as the sub socket gets it
  function ack(serial: string) {
    var push = socket('push')
    var solo = wire.Envelope.decode(push.sent[0]![1]!)
    var introduction = wire.DeviceIntroductionMessage.decode(solo.message)
    socket('sub').listeners.forEach(function(listener) {
      listener(
        Buffer.from(introduction.provider.channel)
      , wireutil.envelope(new wire.DeviceRegisteredMessage(serial))
      )
    })
  }

  // Lets the bluebird chains of the provider settle between the fake timers
  async function settle() {
    for (var i = 0; i < 5; i++) {
      await new Promise(function(resolve) {
        setImmediate(resolve)
      })
    }
  }

  async function start() {
    var provider = (await importFresh(new URL('units/provider/index.js', lib))).default
    provider({
      name: 'host'
    , killTimeout: 1000
    , ports: [7400, 7401, 7402, 7403]
    , allowRemote: false
    , fork: function() {
        var proc = new EventEmitter() as EventEmitter & {kill(signal?: string): void}
        proc.kill = function(signal) {
          process.nextTick(function() {
            proc.emit('exit', null, signal || 'SIGTERM')
          })
        }
        return proc
      }
    , endpoints: {
        sub: ['tcp://127.0.0.1:7250']
      , push: ['tcp://127.0.0.1:7270']
      }
    , adbHost: '127.0.0.1'
    , adbPort: 5037
    })
    await settle()
    tracker.emit('add', {id: 'serial1', type: 'device'})
    await settle()
  }

  beforeEach(function() {
    tracker = new EventEmitter()
    sockets = []
    observers = []
    entries = []
    clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    restoreAdb = mockModule(new URL('util/adbutil.js', lib), {
      default: function() {
        return {
          trackDevices: function() {
            return Promise.resolve(tracker)
          }
        }
      }
    })
    sinon.stub(zmqutil, 'socket').callsFake(function(type: string) {
      var sock: FakeSocket = {type: type, sent: [], listeners: []}
      sockets.push(sock)
      return {
        connect: function() {}
      , subscribe: function() {}
      , close: function() {}
      , send: function(message: Buffer[]) {
          sock.sent.push(message)
        }
      , on: function(event: string, listener: (channel: Buffer, data: Buffer) => void) {
          if (event === 'message') {
            sock.listeners.push(listener)
          }
        }
      } as unknown as ReturnType<typeof zmqutil.socket>
    })
    fatal = sinon.stub(lifecycle, 'fatal')
    sinon.stub(lifecycle, 'graceful')
    sinon.stub(lifecycle, 'share')
    sinon.stub(lifecycle, 'observe').callsFake(function(fn: () => unknown) {
      observers.push(fn)
    })
    sinon.stub(zmqcurve, 'clientHint').returns('Check that the ZeroMQ server lets this host in: ' +
      'its CURVE public key 0123 in STF_ZMQ_CURVE_CLIENT_KEYS of the server.')
    sinon.stub(console, 'error')
    logger.on('entry', onEntry)
  })

  afterEach(async function() {
    await Promise.all(observers.map(function(fn) {
      return fn()
    }))
    await settle()
    logger.removeListener('entry', onEntry)
    restoreAdb()
    clock.restore()
    sinon.restore()
  })

  it('should wait for a pending registration instead of giving the device up', async function() {
    await start()
    expect(socket('push').sent).to.have.length(1)

    await clock.tickAsync(10000)
    await settle()
    expect(messages(logger.Level.INFO)).to.include(
      'Providing 0 of 1 device(s); waiting for "serial1"')
    expect(messages(logger.Level.FATAL)).to.deep.equal([])
    expect(fatal.called).to.equal(false)
  })

  it('should exit with what to check when no registration ack comes', async function() {
    await start()

    await clock.tickAsync(14999)
    await settle()
    expect(fatal.called).to.equal(false)

    await clock.tickAsync(1)
    await settle()
    expect(fatal.calledOnce).to.equal(true)
    expect(messages(logger.Level.FATAL)).to.deep.equal([
      'No registration ack for "serial1" in 15000 ms: the STF processor does not get the ' +
      'messages of this provider. Check that the ZeroMQ server lets this host in: its CURVE ' +
      'public key 0123 in STF_ZMQ_CURVE_CLIENT_KEYS of the server.'
    ])
    expect(messages(logger.Level.WARNING).join('\n')).not.to.contain('proceeding anyway')
    expect(messages(logger.Level.INFO)).not.to.include('Registered device "serial1"')
  })

  it('should start the worker after the ack and wait for it then', async function() {
    await start()
    await clock.tickAsync(5000)
    ack('serial1')
    await settle()
    expect(messages(logger.Level.INFO)).to.include('Registered device "serial1"')

    // the worker, forked 100 ms after the registration, never says it is ready
    await clock.tickAsync(10000)
    await settle()
    expect(fatal.called).to.equal(false)
    expect(messages(logger.Level.INFO)).to.include(
      'Providing 0 of 1 device(s); waiting for "serial1"')
  })

  it('should still exit when the registered device cannot be provided', async function() {
    await start()
    tracker.emit('change', {id: 'serial1', type: 'unauthorized'})
    ack('serial1')
    await settle()
    await clock.tickAsync(200)
    await settle()

    await clock.tickAsync(10000)
    await settle()
    expect(fatal.calledOnce).to.equal(true)
    expect(messages(logger.Level.FATAL)).to.deep.equal([
      'Providing all 0 of 1 device(s); ignoring "serial1"'
    ])
  })
})
