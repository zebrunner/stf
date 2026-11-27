// Fork (Zebrunner): the WebSocket of the UI refuses the handshake of a page of another origin,
// lib/units/websocket/zebrunner-origin.ts and its allowRequest in lib/units/websocket/index.ts
import {expect} from 'chai'
import WebSocket from 'ws'

import origin from '../../../lib/units/websocket/zebrunner-origin.js'
import {mockModule} from '../../helpers/module-mock.mts'
import {startUnit, type Running} from '../../helpers/zebrunner.mts'

var PUBLIC = 'https://mcloud.example.com'

describe('zebrunner: websocket origin', function() {
  var allowed = origin.allowedOrigins(['http://localhost:7100/stf'], PUBLIC + '/')

  function refusal(headers: Record<string, string>) {
    return origin.originRefusal(headers, allowed)
  }

  it('should take the origins of the options and of the storage URL', function() {
    expect(Array.from(allowed).sort()).to.eql(['http://localhost:7100', PUBLIC])
    expect(Array.from(origin.allowedOrigins(['not a url', 'file:///x'], ''))).to.eql([])
  })

  it('should let in no Origin, an allowed one and the one of the Host of the request', function() {
    expect(refusal({host: 'stf-proxy'})).to.equal(null)
    expect(refusal({host: 'stf-proxy', origin: ''})).to.equal(null)
    expect(refusal({host: 'stf-proxy', origin: PUBLIC})).to.equal(null)
    expect(refusal({host: 'stf-proxy', origin: 'HTTPS://MCloud.Example.com:443'})).to.equal(null)
    expect(refusal({host: 'stf-proxy', origin: 'http://localhost:7100'})).to.equal(null)
    expect(refusal({host: '127.0.0.1:7100', origin: 'http://127.0.0.1:7100'})).to.equal(null)
    expect(refusal({host: 'stf.lan', origin: 'https://stf.lan'})).to.equal(null)
  })

  it('should refuse another site, another port and an opaque origin', function() {
    expect(refusal({host: 'stf-proxy', origin: 'https://evil.example.com'})).to.be.a('string')
    expect(refusal({host: 'mcloud.example.com', origin: 'https://mcloud.example.com.evil.org'}))
      .to.be.a('string')
    expect(refusal({host: 'stf-proxy', origin: 'http://mcloud.example.com'})).to.be.a('string')
    expect(refusal({host: '127.0.0.1:7110', origin: 'http://127.0.0.1:7100'})).to.be.a('string')
    expect(refusal({host: 'stf-proxy', origin: 'null'})).to.be.a('string')
    expect(refusal({host: 'stf-proxy', origin: 'chrome-extension://abc'})).to.be.a('string')
    expect(refusal({origin: 'https://evil.example.com'})).to.be.a('string')
  })

  describe('the unit', function() {
    var unit: Running
    var restore: Array<() => void> = []

    before(async function() {
      var fakeSocket = {
        connect() {}
      , subscribe() {}
      , unsubscribe() {}
      , on() {}
      , send() {}
      , close() {}
      }
      restore.push(mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}}))
      restore.push(mockModule(new URL('../../../lib/util/zmqutil.js', import.meta.url), {default: {
        socket: function() {
          return fakeSocket
        }
      }}))
      unit = await startUnit(new URL('../../../lib/units/websocket/index.js', import.meta.url), {
        secret: 'websocket-secret'
      , ssid: 'ssid'
      , storageUrl: PUBLIC + '/'
      , allowedOrigins: []
      , endpoints: {sub: ['tcp://127.0.0.1:1'], push: ['tcp://127.0.0.1:1']}
      })
    })

    after(async function() {
      await unit.close()
      restore.forEach(function(undo) {
        undo()
      })
    })

    // handshake <origin>: 'open', or the HTTP status of a refused handshake
    function handshake(from?: string): Promise<string | number> {
      return new Promise(function(resolve) {
        var url = unit.origin.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket'
        var ws = new WebSocket(url, from ? {headers: {origin: from}} : {})
        ws.on('open', function() {
          ws.close()
          resolve('open')
        })
        ws.on('unexpected-response', function(req, res) {
          resolve(res.statusCode!)
          req.destroy()
        })
        ws.on('error', function() {})
      })
    }

    it('should open the socket for the public URL and without Origin', async function() {
      expect(await handshake(PUBLIC)).to.equal('open')
      expect(await handshake()).to.equal('open')
    })

    it('should refuse the handshake of a page of another origin', async function() {
      expect(await handshake('https://evil.example.com')).to.be.a('number').within(400, 403)
      expect(await handshake('null')).to.be.a('number').within(400, 403)
    })
  })
})
