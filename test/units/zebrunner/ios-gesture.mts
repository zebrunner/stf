// Fork (Zebrunner): the whole gestures of iOS devices (lib/units/ios-device/plugins/wda/gesture.ts,
// lib/wire/zebrunner.ts) replayed as W3C actions of WDA
import {expect} from 'chai'
import express from 'express'

import {
  normalize
, pathActions
, replayPath
, toDevice
, type PathPoint
} from '../../../lib/units/ios-device/plugins/wda/gesture.js'
import {touchPathIosContacts, touchPathIosMessage} from '../../../lib/wire/zebrunner.js'
import wire from '../../../lib/wire/index.js'
import type {WdaClientPlugin} from '../../../lib/types/ios-device.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

var SIZE = {width: 400, height: 800}

function portrait(point: PathPoint): PathPoint {
  return toDevice('PORTRAIT', SIZE, point)
}

describe('zebrunner: iOS gestures', function() {
  describe('the points', function() {
    it('should map the points of the screen to the points of WDA by the orientation', function() {
      expect(toDevice('PORTRAIT', SIZE, {x: 0.25, y: 0.5, t: 5}))
        .to.deep.equal({x: 100, y: 400, t: 5})
      expect(toDevice(null, SIZE, {x: 1, y: 1, t: 0})).to.deep.equal({x: 399, y: 799, t: 0})
      expect(toDevice('LANDSCAPE', SIZE, {x: 0.25, y: 0.5, t: 0}))
        .to.deep.equal({x: 400, y: 100, t: 0})
      expect(toDevice('PORTRAIT', SIZE, {x: -1, y: 2, t: 0})).to.deep.equal({x: 0, y: 799, t: 0})
    })

    it('should put the points on ticks, drop the invalid ones and the empty fingers', function() {
      expect(normalize([
        {points: [
          {x: 0, y: 0, t: 0}
        , {x: 0.1, y: 0, t: 5}
        , {x: NaN, y: 0, t: 20}
        , {x: 0.2, y: 0, t: 30}
        , {x: 0.3, y: 0, t: -1}
        ]}
      , {points: []}
      , {points: null}
      ], portrait)).to.deep.equal([[{x: 40, y: 0, t: 0}, {x: 80, y: 0, t: 32}]])
    })
  })

  describe('the actions', function() {
    it('should replay a finger with the timing of its moves', function() {
      var [finger] = pathActions([
        [{x: 10, y: 700, t: 0}, {x: 10, y: 400, t: 48}, {x: 10, y: 100, t: 96}]
      ])
      expect(finger!.id).to.equal('finger1')
      expect(finger!.parameters).to.deep.equal({pointerType: 'touch'})
      expect(finger!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 10, y: 700}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerMove', duration: 48, x: 10, y: 400}
      , {type: 'pointerMove', duration: 48, x: 10, y: 100}
      , {type: 'pointerUp', button: 0}
      ])
    })

    it('should hold a finger that stands still', function() {
      var [finger] = pathActions([[{x: 10, y: 10, t: 0}, {x: 10, y: 10, t: 1600}]])
      expect(finger!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 10, y: 10}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerMove', duration: 1600, x: 10, y: 10}
      , {type: 'pointerUp', button: 0}
      ])
    })

    it('should touch and release a finger of one point', function() {
      var [finger] = pathActions([[{x: 5, y: 6, t: 0}]])
      expect(finger!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 5, y: 6}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerUp', button: 0}
      ])
    })

    it('should keep the fingers on the same ticks', function() {
      var sources = pathActions([
        [{x: 0, y: 0, t: 0}, {x: 100, y: 0, t: 100}]
      , [{x: 50, y: 50, t: 32}, {x: 50, y: 150, t: 64}]
      ])
      expect(sources.map(function(source) {
        return source.id
      })).to.deep.equal(['finger1', 'finger2'])
      var [first, second] = sources
      expect(first!.actions.length).to.equal(second!.actions.length)
      expect(first!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 0, y: 0}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerMove', duration: 32, x: 32, y: 0}
      , {type: 'pause', duration: 0}
      , {type: 'pointerMove', duration: 32, x: 64, y: 0}
      , {type: 'pause', duration: 0}
      , {type: 'pointerMove', duration: 36, x: 100, y: 0}
      , {type: 'pointerUp', button: 0}
      ])
      expect(second!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 50, y: 50}
      , {type: 'pause', duration: 0}
      , {type: 'pause', duration: 32}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerMove', duration: 32, x: 50, y: 150}
      , {type: 'pointerUp', button: 0}
      , {type: 'pause', duration: 36}
      , {type: 'pause', duration: 0}
      ])
    })
  })

  describe('the message', function() {
    it('should keep only the numbers of the UI, in their ranges', function() {
      expect(touchPathIosContacts([
        {points: [{x: 0.5, y: 2, t: 10.4}, {x: '1', y: 0, t: 0}, null, {x: -1, y: 0.5, t: -5}]}
      , {points: 'no'}
      , null
      ])).to.deep.equal([{points: [{x: 0.5, y: 1, t: 10}, {x: 0, y: 0.5, t: 0}]}])
      expect(touchPathIosContacts('no')).to.deep.equal([])
    })

    it('should go through the wire', function() {
      var message = touchPathIosMessage([{points: [{x: 0.5, y: 0.25, t: 16}]}])
      var decoded = wire.TouchPathIosMessage.decode(message.encode())
      expect(decoded.contacts).to.have.length(1)
      expect(decoded.contacts[0]!.points[0]).to.include({x: 0.5, y: 0.25, t: 16})
    })
  })

  describe('replayPath', function() {
    var server: Running
      , bodies: unknown[]
      , status: number

    beforeEach(async function() {
      bodies = []
      status = 200
      var app = express()
      app.use(express.json())
      app.post('/session/:id/actions', function(req, res) {
        bodies.push(req.body)
        res.status(status).json({
          value: status === 200 ? null : {error: 'invalid argument', message: 'bad'}
        })
      })
      server = await listen(app)
    })

    afterEach(async function() {
      await server.close()
    })

    function client(values: Partial<WdaClientPlugin> = {}): WdaClientPlugin {
      return Object.assign({
        baseUrl: server.origin
      , sessionId: 's1'
      , deviceSize: SIZE
      , orientation: 'PORTRAIT'
      , deviceType: 'iPhone'
      , isSwiping: false
      }, values) as WdaClientPlugin
    }

    it('should post the actions and hold the taps while it runs', async function() {
      var wda = client()
      var replay = replayPath(wda, [{points: [{x: 0.5, y: 0.75, t: 0}, {x: 0.5, y: 0.25, t: 80}]}])
      expect(wda.isSwiping).to.equal(true)
      await replay
      expect(wda.isSwiping).to.equal(false)
      expect(bodies).to.have.length(1)
      var body = bodies[0] as {actions: Array<{actions: unknown[]}>}
      expect(body.actions[0]!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 200, y: 600}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerMove', duration: 80, x: 200, y: 200}
      , {type: 'pointerUp', button: 0}
      ])
    })

    it('should survive an error of WDA', async function() {
      status = 400
      var wda = client()
      await replayPath(wda, [{points: [{x: 0.5, y: 0.5, t: 0}]}])
      expect(bodies).to.have.length(1)
      expect(wda.isSwiping).to.equal(false)
    })

    it('should skip Apple TV, a running gesture and a device without a size', async function() {
      await replayPath(client({deviceType: 'Apple TV'}), [{points: [{x: 0, y: 0, t: 0}]}])
      await replayPath(client({isSwiping: true}), [{points: [{x: 0, y: 0, t: 0}]}])
      await replayPath(client({deviceSize: null}), [{points: [{x: 0, y: 0, t: 0}]}])
      await replayPath(client(), [])
      expect(bodies).to.deep.equal([])
    })
  })
})
