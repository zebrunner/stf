// Fork (Zebrunner): the fixed connect port of a provider (lib/util/zebrunner-connect-port.ts, the
// provider command) and the ports of an Android device worker sent for its device document
import childProcess from 'child_process'
import {EventEmitter} from 'node:events'

import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'
import sinon from 'sinon'
import yargs from 'yargs'

import * as provider from '../../../lib/cli/provider/index.js'
import logger from '../../../lib/util/logger.js'
import zebrunnerConnectPort from '../../../lib/util/zebrunner-connect-port.js'
import wire from '../../../lib/wire/index.js'
import wirerouter from '../../../lib/wire/router.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)

describe('zebrunner: device ports', function() {
  var warnings: string[]

  function onEntry(entry: logger.Entry) {
    if (entry.tag === 'provider:connect-port' && entry.priority === logger.Level.WARNING) {
      warnings.push(entry.message)
    }
  }

  beforeEach(function() {
    warnings = []
    logger.on('entry', onEntry)
  })

  afterEach(function() {
    logger.removeListener('entry', onEntry)
    sinon.restore()
  })

  describe('connectPorts', function() {
    var range = zebrunnerConnectPort.range(7404, 7410)

    it('should leave the pool and the ports of the workers as they are without it', function() {
      var ports = zebrunnerConnectPort.connectPorts(range)
      expect(ports.pool).to.eql(range)
      expect(ports.worker('serial1', [7404, 7405, 7406, 7407]).ports)
        .to.eql([7404, 7405, 7406, 7407])
      expect(ports.worker('serial2', [7408, 7409, 7410, 7411]).ports)
        .to.eql([7408, 7409, 7410, 7411])
    })

    it('should take the fixed port out of the pool and give it to the worker', function() {
      var ports = zebrunnerConnectPort.connectPorts(range, 7405)
      expect(ports.pool).to.eql([7404, 7406, 7407, 7408, 7409, 7410])
      expect(ports.worker('serial1', [7404, 7406, 7407, 7408]).ports)
        .to.eql([7404, 7405, 7407, 7408])
    })

    it('should keep a fixed port outside of the range out of the pool', function() {
      var ports = zebrunnerConnectPort.connectPorts(range, 5555)
      expect(ports.pool).to.eql(range)
      expect(ports.worker('serial1', [7404, 7405, 7406, 7407]).ports)
        .to.eql([7404, 5555, 7406, 7407])
    })

    it('should give the fixed port to one worker at a time', function() {
      var ports = zebrunnerConnectPort.connectPorts(zebrunnerConnectPort.range(7400, 7408), 7408)
      var first = ports.worker('serial1', [7400, 7401, 7402, 7403])
      var second = ports.worker('serial2', [7404, 7405, 7406, 7407])
      expect(first.ports[1]).to.equal(7408)
      expect(second.ports[1]).to.equal(7405)
      expect(warnings).to.eql([
        'The connect port 7408 is held by the device "serial1", the device "serial2" gets 7405 ' +
        'of the pool'
      ])

      // only the holder frees it
      second.release()
      expect(ports.worker('serial3', [7404, 7405, 7406, 7407]).ports[1]).to.equal(7405)
      first.release()
      first.release()
      var again = ports.worker('serial1', [7400, 7401, 7402, 7403])
      expect(again.ports[1]).to.equal(7408)
      expect(ports.worker('serial2', [7404, 7405, 7406, 7407]).ports[1]).to.equal(7405)
    })

    it('should not change the ports of the provider unit', function() {
      var allocated = [7404, 7406, 7407, 7408]
      zebrunnerConnectPort.connectPorts(range, 7405).worker('serial1', allocated)
      expect(allocated).to.eql([7404, 7406, 7407, 7408])
    })
  })

  describe('checkConnectPort', function() {
    it('should accept no fixed port or a port with 4 more ports in the range', function() {
      expect(zebrunnerConnectPort.checkConnectPort(7404, 7407)).to.equal(true)
      expect(zebrunnerConnectPort.checkConnectPort(7404, 7410, 7405)).to.equal(true)
      expect(zebrunnerConnectPort.checkConnectPort(7404, 7407, 7408)).to.equal(true)
      expect(zebrunnerConnectPort.checkConnectPort(7404, 7407, 1)).to.equal(true)
      expect(zebrunnerConnectPort.checkConnectPort(7404, 7407, 65535)).to.equal(true)
    })

    it('should refuse a port out of 1..65535', function() {
      [0, -1, 65536, 7405.5, NaN].forEach(function(port) {
        expect(zebrunnerConnectPort.checkConnectPort.bind(null, 7404, 7410, port))
          .to.throw(`Invalid --connect-port "${port}", expected a port of 1..65535`)
      })
    })

    it('should refuse a range without 4 ports besides the fixed one', function() {
      expect(zebrunnerConnectPort.checkConnectPort.bind(null, 7404, 7407, 7405))
        .to.throw('--min-port 7404..--max-port 7407 needs 4 ports besides --connect-port 7405')
    })
  })

  describe('stf provider', function() {
    var args = [
      '--connect-push', 'tcp://dev:7270'
    , '--connect-sub', 'tcp://dev:7250'
    , '--storage-url', 'http://stf/'
    , '--min-port', '7404'
    , '--max-port', '7410'
    ]
    var procs: Array<EventEmitter & {args: string[]}>
      , options: {ports: number[], fork(device: {id: string}, ports: number[]): unknown}

    // the options the handler gives to the provider unit, child_process.fork stubbed
    async function start(extra: string[]) {
      var argv = provider.builder(yargs(args.concat(extra))).exitProcess(false).parseSync()
      procs = []
      sinon.stub(childProcess, 'fork').callsFake(function(_cli: unknown, forkArgs: unknown) {
        var proc = Object.assign(new EventEmitter(), {args: (forkArgs as unknown[]).map(String)})
        procs.push(proc)
        return proc as unknown as childProcess.ChildProcess
      })
      var restore = mockModule(new URL('units/provider/index.js', lib), {
        default: function(unitOptions: typeof options) {
          options = unitOptions
        }
      })
      try {
        provider.handler(argv as Parameters<typeof provider.handler>[0])
      }
      finally {
        restore()
      }
    }

    function portArgs(proc: {args: string[]}) {
      var screen = proc.args.indexOf('--screen-port')
      var connect = proc.args.indexOf('--connect-port')
      return [Number(proc.args[screen + 1]), Number(proc.args[connect + 1])]
    }

    it('should give the workers the ports of the pool without a fixed port', async function() {
      await start([])
      expect(options.ports).to.eql([7404, 7405, 7406, 7407, 7408, 7409, 7410])
      options.fork({id: 'serial1'}, [7404, 7405, 7406, 7407])
      expect(portArgs(procs[0]!)).to.eql([7404, 7405])
    })

    it('should give STF_PROVIDER_CONNECT_PORT to one worker at a time', async function() {
      var saved = process.env.STF_PROVIDER_CONNECT_PORT
      process.env.STF_PROVIDER_CONNECT_PORT = '7405'
      try {
        await start([])
      }
      finally {
        if (typeof saved === 'undefined') {
          delete process.env.STF_PROVIDER_CONNECT_PORT
        }
        else {
          process.env.STF_PROVIDER_CONNECT_PORT = saved
        }
      }
      expect(options.ports).to.eql([7404, 7406, 7407, 7408, 7409, 7410])

      options.fork({id: 'serial1'}, [7404, 7406, 7407, 7408])
      options.fork({id: 'serial2'}, [7409, 7410, 7411, 7412])
      expect(portArgs(procs[0]!)).to.eql([7404, 7405])
      expect(portArgs(procs[1]!)).to.eql([7409, 7410])

      // the port is free again when its worker exits
      procs[0]!.emit('exit', 1, null)
      options.fork({id: 'serial1'}, [7404, 7406, 7407, 7408])
      expect(portArgs(procs[2]!)).to.eql([7404, 7405])
    })
  })

  describe('Android device worker', function() {
    it('should send its ports before it is ready', async function() {
      var pushed: Buffer[][] = []
      var module = function(file: string) {
        return new URL(file, lib)
      }
      var restores = [
        mockModule(module('units/device/support/push.js'), {
          default: syrup.serial().define(function() {
            return {
              send: function(message: Buffer[]) {
                pushed.push(message)
              }
            }
          })
        })
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
        var plugin = (await importFresh(module('units/device/plugins/solo.js'))).default
        solo = await plugin.consume({serial: 'serial1', screenPort: 7404, connectPort: 7405})
      }
      finally {
        restores.forEach(function(restore) {
          restore()
        })
      }

      solo!.poke()
      var envelopes = pushed.map(function(message) {
        return wire.Envelope.decode(message[1]!)
      })
      expect(envelopes.map(function(envelope) {
        return envelope.type
      })).to.eql([wire.MessageType.DevicePortsMessage, wire.MessageType.DeviceReadyMessage])
      var ports = wire.DevicePortsMessage.decode(envelopes[0]!.message)
      expect([ports.serial, ports.screenPort, ports.connectPort]).to.eql(['serial1', 7404, 7405])
    })
  })
})
