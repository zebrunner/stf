// Fork (Zebrunner): the touches of the UI on an iOS device, lib/units/ios-device/plugins/wda/
// WdaClient.ts. The size of the device is the natural (portrait) one, the taps turn the points of a
// landscape screen as the swipes and the gestures do: a session that started landscape turned them
// twice and tapped the wrong points, a session of another orientation got no size and ignored the
// touches.
import net from 'node:net'

import {expect} from 'chai'
import express from 'express'

import iosutil from '../../../lib/units/ios-device/plugins/util/iosutil.js'
import {toDevice} from '../../../lib/units/ios-device/plugins/wda/gesture.js'
import type {IosOrientation} from '../../../lib/types/ios-device.js'
import {loadWdaClient, type IosWda} from '../../helpers/ios-wda.mts'
import {listen, type Running} from '../../helpers/zebrunner.mts'

interface Posted {
  path: string
  body: any
}

// An iPhone of 390 x 844 points (1170 x 2532 pixels)
var DISPLAY = {width: 1170, height: 2532, scale: 3}
var SIZE = {width: 390, height: 844}
var MOVE = {fromX: 0.25, fromY: 0.5, toX: 0.5, toY: 0.75, duration: 1}
var LANDSCAPES: IosOrientation[] = ['LANDSCAPE', 'UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT']
var PORTRAITS: Array<IosOrientation | null> =
  ['PORTRAIT', 'UIA_DEVICE_ORIENTATION_PORTRAIT_UPSIDEDOWN', null]

describe('zebrunner: iOS touches', function() {
  describe('the points', function() {
    it('should turn the points of both landscape orientations', function() {
      for (var orientation of LANDSCAPES) {
        expect(iosutil.isLandscape(orientation)).to.equal(true)
        expect(toDevice(orientation, SIZE, {x: 0.25, y: 0.5, t: 0}))
          .to.deep.equal({x: 422, y: 98, t: 0})
        expect(iosutil.swipe(orientation, MOVE, SIZE))
          .to.deep.equal({fromX: 422, fromY: 97.5, toX: 633, toY: 195, duration: 1})
      }
    })

    it('should keep the points of portrait and of an unknown orientation', function() {
      for (var orientation of PORTRAITS) {
        expect(iosutil.isLandscape(orientation)).to.equal(false)
        expect(toDevice(orientation, SIZE, {x: 0.25, y: 0.5, t: 0}))
          .to.deep.equal({x: 98, y: 422, t: 0})
      }
    })
  })

  describe('WdaClient', function() {
    var orientation: IosOrientation
      , posted: Posted[]
      , wda: Running
      , mjpeg: net.Server
      , mjpegPort: number
    var sockets: net.Socket[] = []

    before(async function() {
      var app = express()
      app.use(express.json())
      app.get('/status', function(req, res) {
        res.json({value: {ready: true}, sessionId: 'appium'})
      })
      app.get('/session/:id', function(req, res) {
        res.json({
          sessionId: req.params.id
        , value: {capabilities: {device: 'iphone', sdkVersion: '17.4'}}
        })
      })
      app.get('/session/:id/orientation', function(req, res) {
        res.json({value: orientation})
      })
      app.get('/session/:id/wda/batteryInfo', function(req, res) {
        res.json({value: {state: 2, level: 0.8}})
      })
      app.post('/session/:id/*path', function(req, res) {
        posted.push({path: req.path.replace(/^\/session\/[^/]+/, ''), body: req.body})
        res.json({value: null})
      })
      wda = await listen(app)
      mjpeg = net.createServer(function(socket) {
        sockets.push(socket)
      })
      await new Promise<void>(function(resolve) {
        mjpeg.listen(0, '127.0.0.1', resolve)
      })
      mjpegPort = (mjpeg.address() as net.AddressInfo).port
    })

    after(async function() {
      await wda.close()
      sockets.forEach(function(socket) {
        socket.destroy()
      })
      await new Promise(function(resolve) {
        mjpeg.close(resolve)
      })
    })

    beforeEach(function() {
      posted = []
    })

    // started <orientation>: a client of a fresh unit whose session starts in the orientation
    async function started(start: IosOrientation): Promise<IosWda> {
      orientation = start
      var wdaClient = await loadWdaClient({
        serial: 'udid'
      , wdaHost: '127.0.0.1'
      , wdaPort: Number(new URL(wda.origin).port)
      , connectPort: mjpegPort
      })
      wdaClient.setDisplay(DISPLAY)
      await wdaClient.client.startSession()
      for (var i = 0; i < 40 && wdaClient.client.orientation !== start; i++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 25)
        })
      }
      expect(wdaClient.client.orientation).to.equal(start)
      return wdaClient
    }

    function tapAt(posts: Posted[]) {
      var tap = posts.find(function(entry) {
        return entry.path === '/actions'
      })
      return tap!.body.actions[0].actions[0]
    }

    it('should take the natural size of a session that starts landscape', async function() {
      var wdaClient = await started('LANDSCAPE')
      expect(wdaClient.client.deviceSize).to.eql(SIZE)
    })

    it('should tap the point of a landscape screen', async function() {
      for (var start of LANDSCAPES) {
        var wdaClient = await started(start)
        posted = []
        wdaClient.client.tap({x: 0.25, y: 0.5} as any)
        await wdaClient.client.touchUp()
        expect(tapAt(posted), start).to.include({type: 'pointerMove', x: 422, y: 98})
      }
    })

    it('should tap the edges of the screen within it', async function() {
      var wdaClient = await started('PORTRAIT')
      wdaClient.client.tap({x: 1, y: 1} as any)
      await wdaClient.client.touchUp()
      expect(tapAt(posted)).to.include({x: 389, y: 843})
    })

    it('should hold and double tap the point of a landscape screen', async function() {
      var wdaClient = await started('LANDSCAPE')
      wdaClient.client.tap({x: 0.25, y: 0.5} as any)
      wdaClient.client.tapStartAt = Date.now() - 2000
      await wdaClient.client.touchUp()
      await wdaClient.client.doubleClick()
      expect(posted).to.deep.equal([
        {path: '/wda/touchAndHold', body: {x: 422, y: 98, duration: 1}}
      , {path: '/wda/doubleTap', body: {x: 422, y: 98}}
      ])
    })
  })
})
