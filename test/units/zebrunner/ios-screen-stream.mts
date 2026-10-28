// Fork (Zebrunner): the screen stream of the ios-device unit, lib/units/ios-device/plugins/screen/stream.ts.
// The MJPEG request to WDA outlived the socket of the browser, WDA queued every frame for it and grew
// until iOS killed the processes of the device and the device went offline.
import http from 'node:http'
import net from 'node:net'

import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'
import sinon from 'sinon'
import * as wsModule from 'ws'

import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)

function module(path: string) {
  return new URL(path, lib)
}

// A JPEG for mjpeg-consumer: it only looks for the start and end markers
var FRAME = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9])

interface FakeMjpeg {
  server: http.Server
  port: number
  requests: number
  open: number
}

async function fakeMjpeg(): Promise<FakeMjpeg> {
  var state = {requests: 0, open: 0} as FakeMjpeg
  state.server = http.createServer(function(req, res) {
    state.requests++
    state.open++
    res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=--BoundaryString'})
    // setTimeout, the heartbeat test fakes setInterval
    var timer: NodeJS.Timeout
    var send = function() {
      res.write('--BoundaryString\r\nContent-type: image/jpeg\r\n')
      res.write('Content-Length: ' + FRAME.length + '\r\n\r\n')
      res.write(FRAME)
      res.write('\r\n\r\n')
      timer = setTimeout(send, 20)
    }
    send()
    res.on('close', function() {
      clearTimeout(timer)
      state.open--
    })
  })
  await new Promise<void>(function(resolve) {
    state.server.listen(0, '127.0.0.1', resolve)
  })
  state.port = (state.server.address() as net.AddressInfo).port
  return state
}

function freePort(): Promise<number> {
  return new Promise(function(resolve) {
    var server = net.createServer()
    server.listen(0, '127.0.0.1', function() {
      var port = (server.address() as net.AddressInfo).port
      server.close(function() {
        resolve(port)
      })
    })
  })
}

// until <check>: waits up to 3 s for the check to pass
async function until(check: () => boolean) {
  for (var i = 0; i < 60 && !check(); i++) {
    await new Promise(function(resolve) {
      setTimeout(resolve, 50)
    })
  }
  expect(check()).to.equal(true)
}

function sleep(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

describe('zebrunner: iOS screen stream', function() {
  this.timeout(10000)

  var mjpeg: FakeMjpeg, screenPort: number
  var servers: wsModule.WebSocketServer[] = []
  var unavailable: unknown[] = []
  var stopped = 0

  before(async function() {
    mjpeg = await fakeMjpeg()
    screenPort = await freePort()

    class TrackedServer extends wsModule.WebSocketServer {
      constructor(options: wsModule.ServerOptions) {
        super(options)
        servers.push(this)
      }
    }

    var restores = [
      mockModule(new URL(import.meta.resolve('ws')), Object.assign({}, wsModule, {
        WebSocketServer: TrackedServer
      }))
    , mockModule(module('units/ios-device/plugins/solo.js'), {
        default: syrup.serial().define(function() {
          return {}
        })
      })
    , mockModule(module('units/ios-device/plugins/devicenotifier.js'), {
        default: syrup.serial().define(function() {
          return {
            setDeviceTemporaryUnavailable: function(err: unknown) {
              unavailable.push(err)
            }
          }
        })
      })
    , mockModule(module('units/ios-device/plugins/wda/WdaClient.js'), {
        default: syrup.serial().define(function() {
          return {
            isSwiping: false
          , startSession: function() {
              return Promise.resolve()
            }
          , stopSession: function() {
              stopped++
              return Promise.resolve()
            }
          }
        })
      })
    , mockModule(module('units/ios-device/support/push.js'), {
        default: syrup.serial().define(function() {
          return {}
        })
      })
    ]
    try {
      var stream = (await importFresh(module('units/ios-device/plugins/screen/stream.js'))).default
      await stream.consume({
        serial: 'udid'
      , screenPort: screenPort
      , wdaHost: '127.0.0.1'
      , connectPort: mjpeg.port
      })
    }
    finally {
      restores.forEach(function(restore) {
        restore()
      })
    }
  })

  after(async function() {
    servers.forEach(function(server) {
      server.clients.forEach(function(client) {
        client.terminate()
      })
      server.close()
    })
    mjpeg.server.closeAllConnections()
    await new Promise(function(resolve) {
      mjpeg.server.close(resolve)
    })
  })

  beforeEach(function() {
    mjpeg.requests = 0
    unavailable.length = 0
    stopped = 0
  })

  function connect(options?: wsModule.ClientOptions) {
    return new wsModule.WebSocket('ws://127.0.0.1:' + screenPort, options)
  }

  it('should close the MJPEG request when the browser closes the socket', async function() {
    var ws = connect()
    var frames = 0
    ws.on('message', function() {
      frames++
    })
    await until(function() {
      return frames > 0
    })
    expect(mjpeg.open).to.equal(1)

    ws.close()
    await until(function() {
      return mjpeg.open === 0
    })
    expect(stopped).to.equal(1)
    expect(unavailable).to.eql([])
  })

  it('should not request MJPEG when the browser leaves before the start', async function() {
    var ws = connect()
    await new Promise(function(resolve) {
      ws.on('open', resolve)
    })
    ws.close()
    await sleep(1500)
    expect(mjpeg.requests).to.equal(0)
    expect(mjpeg.open).to.equal(0)
    expect(unavailable).to.eql([])
  })

  it('should close the MJPEG request when the browser stops answering the pings', async function() {
    var clock = sinon.useFakeTimers({toFake: ['setInterval', 'clearInterval']})
    try {
      var ws = connect({autoPong: false})
      var frames = 0
      ws.on('message', function() {
        frames++
      })
      await until(function() {
        return frames > 0
      })

      clock.tick(30000)
      clock.tick(30000)
      await until(function() {
        return mjpeg.open === 0
      })
      expect(ws.readyState).to.not.equal(wsModule.WebSocket.OPEN)
      expect(unavailable).to.eql([])
    }
    finally {
      clock.restore()
    }
  })

  it('should keep the socket of a browser that sends messages and answers pings', async function() {
    var clock = sinon.useFakeTimers({toFake: ['setInterval', 'clearInterval']})
    try {
      var ws = connect()
      var frames: Buffer[] = []
      ws.on('message', function(data: Buffer, isBinary: boolean) {
        if (isBinary) {
          frames.push(data)
        }
      })
      await new Promise(function(resolve) {
        ws.on('open', resolve)
      })
      // more than the 16 KB the stream keeps for a reader: unread, they would pause the socket and
      // its pongs
      for (var i = 0; i < 64; i++) {
        ws.send('x'.repeat(1024))
      }
      await until(function() {
        return frames.length > 0
      })
      expect(frames[0]).to.eql(FRAME)

      clock.tick(30000)
      await sleep(200)
      clock.tick(30000)
      await sleep(200)
      expect(ws.readyState).to.equal(wsModule.WebSocket.OPEN)
      expect(mjpeg.open).to.equal(1)

      ws.close()
      await until(function() {
        return mjpeg.open === 0
      })
      expect(unavailable).to.eql([])
    }
    finally {
      clock.restore()
    }
  })
})
