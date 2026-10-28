// Fork (Zebrunner): a malformed message of ZeroMQ or of the WebSocket of a client does not end
// the unit, lib/util/zebrunner-guard.ts
import {expect} from 'chai'
import {EventEmitter} from 'events'
import http from 'http'
import type {AddressInfo} from 'net'
import {Server} from 'socket.io'
import {io as connect} from 'socket.io-client'

import wire from '../../../lib/wire/index.js'
import wireutil from '../../../lib/wire/util.js'
import wirerouter from '../../../lib/wire/router.js'
import {
  guardListener, guardSocket, reportDropped, resetReported
} from '../../../lib/util/zebrunner-guard.js'

function recordingLog() {
  var lines: string[] = []
  return {
    lines
  , error(...args: unknown[]) {
      var [format, ...values] = args as [string, ...unknown[]]
      lines.push(format.replace(/%s/g, () => String(values.shift())))
    }
  }
}

describe('zebrunner: guard', function() {
  beforeEach(function() {
    resetReported()
  })

  it('should log the same failure once a minute and count the others', function() {
    var log = recordingLog()
    var err = new TypeError('Cannot read properties of undefined (reading \'seq\')')
    var down = 'the "input.touchDown" event of a client'

    reportDropped(log, down, err, 'a@b.c', 1000)
    reportDropped(log, down, err, 'a@b.c', 2000)
    reportDropped(log, down, err, 'd@e.f', 3000)
    reportDropped(log, 'the "input.touchUp" event of a client', err, 'a@b.c', 4000)
    reportDropped(log, down, err, 'a@b.c', 62000)

    expect(log.lines).to.have.length(3)
    expect(log.lines[0]).to.match(/^Dropped the "input.touchDown" event .* \(a@b.c\): TypeError/)
    expect(log.lines[1]).to.match(/^Dropped the "input.touchUp" event of a client/)
    expect(log.lines[2]).to.match(/ \(a@b.c\) and 2 more of the same in the last minute: /)
  })

  it('should report an exception of a listener instead of throwing it', function() {
    var log = recordingLog()
    var listener = guardListener(log, 'an event', function(data: {seq: number}) {
      return data.seq
    }, () => 'the client')

    expect(listener({seq: 7})).to.equal(7)
    expect(() => listener(null as never)).not.to.throw()
    expect(log.lines).to.have.length(1)
    expect(log.lines[0]).to.contain('Dropped an event (the client): TypeError')
  })

  it('should report a rejection of a listener', async function() {
    var log = recordingLog()
    var listener = guardListener(log, 'an event', function() {
      return Promise.reject(new Error('database is down'))
    })

    listener()
    await new Promise((resolve) => setImmediate(resolve))

    expect(log.lines).to.have.length(1)
    expect(log.lines[0]).to.contain('Dropped an event: Error: database is down')
  })

  it('should keep the failure of the detail out of the report', function() {
    var log = recordingLog()
    guardListener(log, 'an event', function() {
      throw new Error('broken')
    }, () => {
      throw new Error('no client')
    })()

    expect(log.lines).to.have.length(1)
    expect(log.lines[0]).to.contain('Dropped an event: Error: broken')
  })

  it('should guard the listeners added to a socket and keep the chaining', function() {
    var log = recordingLog()
    var socket = guardSocket(log, new EventEmitter(), () => 'a@b.c from 10.0.0.1')
    var calls: string[] = []

    var returned = socket
      .on('input.touchDown', function(_channel: string, data: {seq: number}) {
        calls.push(`down ${data.seq}`)
      })
      .on('input.touchUp', function() {
        calls.push('up')
      })

    expect(returned).to.equal(socket)
    expect(() => socket.emit('input.touchDown', 'channel')).not.to.throw()
    socket.emit('input.touchDown', 'channel', {seq: 1})
    socket.emit('input.touchUp', 'channel')
    expect(calls).to.eql(['down 1', 'up'])
    expect(log.lines).to.have.length(1)
    expect(log.lines[0]).to.contain(
      'Dropped the "input.touchDown" event of a client (a@b.c from 10.0.0.1): TypeError'
    )
  })

  describe('wire router', function() {
    var touchDown = () => wireutil.envelope(new wire.TouchDownMessage(1, 0, 0.5, 0.5, 0.5))

    it('should drop a malformed message', function() {
      var handled = 0
      var handler = wirerouter()
        .on(wire.TouchDownMessage, function() {
          handled++
        })
        .handler()

      var garbage = Buffer.from('not a protocol buffer \xff\xff\xff')
      expect(() => handler('channel', garbage)).not.to.throw()
      expect(() => handler('channel', null as never)).not.to.throw()
      handler('channel', touchDown())
      expect(handled).to.equal(1)
    })

    it('should drop the message whose listener fails', function() {
      var handler = wirerouter()
        .on(wire.TouchDownMessage, function(_channel, message) {
          var change = message as unknown as {device: {group: {id: string}}}
          return change.device.group.id
        })
        .handler()

      expect(() => handler('channel', touchDown())).not.to.throw()
    })
  })

  describe('socket.io', function() {
    var server: http.Server, io: Server
    var received: unknown[] = []

    before(async function() {
      server = http.createServer()
      io = new Server(server)
      io.on('connection', function(socket) {
        guardSocket({error() {}}, socket, () => 'the test client')
        socket.on('input.touchDown', function(_channel: string, data: {seq: number}) {
          received.push(data.seq)
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    })

    after(async function() {
      io.close()
      await new Promise((resolve) => server.close(resolve))
    })

    it('should keep the server up after a malformed event', async function() {
      // the listeners of socket.io run in process.nextTick: an exception of one ended the process
      var url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      var client = connect(url, {transports: ['websocket']})
      try {
        await new Promise<void>((resolve) => client.on('connect', () => resolve()))
        client.emit('input.touchDown', 'channel')
        client.emit('input.touchDown', 'channel', {seq: 2})
        var until = Date.now() + 5000
        while (!received.length && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(received).to.eql([2])
        expect(client.connected).to.equal(true)
      }
      finally {
        client.close()
      }
    })
  })
})
