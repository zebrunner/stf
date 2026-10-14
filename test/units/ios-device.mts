import http from 'node:http'
import type {AddressInfo} from 'node:net'

import {expect} from 'chai'

import iosutil from '../../lib/units/ios-device/plugins/util/iosutil.js'
import rp from '../../lib/units/ios-device/plugins/util/rp.js'

describe('ios-device utility mappings', function() {
  it('should map keyboard keys to WDA control characters', function() {
    expect(iosutil.asciiparser('tab')).to.equal('\x09')
    expect(iosutil.asciiparser('enter')).to.equal('\r')
    expect(iosutil.asciiparser('del')).to.equal('\x08')
    expect(iosutil.asciiparser('dpad_left')).to.equal('\v')
    expect(iosutil.asciiparser('dpad_up')).to.equal('\0')
    expect(iosutil.asciiparser('dpad_right')).to.equal('\f')
    expect(iosutil.asciiparser('dpad_down')).to.equal('\x18')
    expect(iosutil.asciiparser('home')).to.equal(null)
    expect(iosutil.asciiparser('a')).to.equal('a')
  })

  it('should convert rotations, battery state, and battery level', function() {
    expect(iosutil.degreesToOrientation(0)).to.equal('PORTRAIT')
    expect(iosutil.degreesToOrientation(90)).to.equal('LANDSCAPE')
    expect(iosutil.orientationToDegrees('UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT')).to.equal(270)
    expect(iosutil.batteryState(1)).to.equal('unplugged')
    expect(iosutil.batteryState(2)).to.equal('charging')
    expect(iosutil.batteryLevel(-1)).to.equal(100)
    expect(iosutil.batteryLevel(0.42)).to.equal(42)
  })

  it('should scale swipe coordinates by orientation', function() {
    expect(iosutil.swipe('PORTRAIT', {
      fromX: 0.1
    , fromY: 0.2
    , toX: 0.3
    , toY: 0.4
    , duration: 0.5
    }, {width: 100, height: 200})).to.deep.equal({
      fromX: 10
    , fromY: 40
    , toX: 30
    , toY: 80
    , duration: 0.5
    })

    expect(iosutil.swipe('LANDSCAPE', {
      fromX: 0.1
    , fromY: 0.2
    , toX: 0.3
    , toY: 0.4
    , duration: 1
    }, {width: 100, height: 200})).to.deep.equal({
      fromX: 40
    , fromY: 10
    , toX: 80
    , toY: 30
    , duration: 1
    })
  })
})

describe('ios-device request promise helper', function() {
  var server: http.Server, origin: string

  before(function(done) {
    server = http.createServer(function(req, res) {
      if (req.url === '/ok') {
        res.statusCode = 200
        res.end('success-body')
        return
      }

      res.statusCode = 418
      res.end('teapot-body')
    })
    server.listen(0, function() {
      origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
      done()
    })
  })

  after(function(done) {
    server.close(done)
  })

  it('should resolve the response body for 2xx responses', async function() {
    expect(await rp<string>({url: origin + '/ok'})).to.equal('success-body')
  })

  it('should reject non-2xx responses with request-promise-compatible fields', async function() {
    try {
      await rp<string>({url: origin + '/fail'})
      throw new Error('rp should have rejected')
    }
    catch (err) {
      expect((err as {name: string}).name).to.equal('StatusCodeError')
      expect((err as {statusCode: number}).statusCode).to.equal(418)
      expect((err as {error: string}).error).to.equal('teapot-body')
    }
  })
})
