// Fork (Zebrunner): the WDA session of the ios-device unit, lib/units/ios-device/plugins/wda/session.ts.
// Creating a WDA session makes WDA kill the active one and terminate its app, so opening a device
// in STF closed the app of a running Appium test (#803, #822, #1031).
import net from 'node:net'

import {expect} from 'chai'
import express from 'express'

import activeOrNewSession from '../../../lib/units/ios-device/plugins/wda/session.js'
import rp from '../../../lib/units/ios-device/plugins/util/rp.js'
import {loadWdaClient, type IosWda} from '../../helpers/ios-wda.mts'
import {listen, type Running} from '../../helpers/zebrunner.mts'

interface FakeWda {
  active: string | null
  calls: string[]
  killed: string[]
}

function fakeWda(state: FakeWda) {
  var app = express()
  var created = 0
  app.use(express.json())
  app.use(function(req, res, next) {
    state.calls.push(req.method + ' ' + req.path)
    next()
  })
  app.get('/status', function(req, res) {
    res.json(Object.assign({value: {ready: true}}, state.active ? {sessionId: state.active} : {}))
  })
  app.post('/session', function(req, res) {
    if (state.active) {
      state.killed.push(state.active)
    }
    state.active = 'stf-' + (++created)
    res.json({
      sessionId: state.active
    , value: {sessionId: state.active, capabilities: {device: 'iphone', sdkVersion: '17.4'}}
    })
  })
  app.get('/session/:id', function(req, res) {
    res.json({
      sessionId: req.params.id
    , value: {id: req.params.id, capabilities: {device: 'iphone', sdkVersion: '18.2'}}
    })
  })
  app.delete('/session/:id', function(req, res) {
    if (state.active === req.params.id) {
      state.active = null
    }
    res.json({value: null})
  })
  app.get('/session/:id/orientation', function(req, res) {
    res.json({value: 'PORTRAIT'})
  })
  app.get('/session/:id/wda/batteryInfo', function(req, res) {
    res.json({value: {state: 2, level: 0.8}})
  })
  return app
}

describe('zebrunner: iOS WDA session', function() {
  var state: FakeWda, wda: Running, mjpeg: net.Server, mjpegPort: number
  var sockets: net.Socket[] = []

  before(async function() {
    state = {active: null, calls: [], killed: []}
    wda = await listen(fakeWda(state))
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
    state.active = null
    state.calls.length = 0
    state.killed.length = 0
  })

  describe('activeOrNewSession', function() {
    it('should reuse the active session of an Appium test', async function() {
      state.active = 'appium'
      var session = await activeOrNewSession(wda.origin, rp)
      expect(session.created).to.equal(false)
      expect(session.response.sessionId).to.equal('appium')
      expect(session.response.value.capabilities.sdkVersion).to.equal('18.2')
      expect(state.killed).to.eql([])
      expect(state.calls).to.not.include('POST /session')
    })

    it('should create a session when there is none', async function() {
      var session = await activeOrNewSession(wda.origin, rp)
      expect(session.created).to.equal(true)
      expect(session.response.sessionId).to.equal(state.active)
      expect(state.calls).to.include('POST /session')
    })
  })

  describe('WdaClient', function() {
    var wdaClient: IosWda

    before(async function() {
      wdaClient = await loadWdaClient({
        serial: 'udid'
      , wdaHost: '127.0.0.1'
      , wdaPort: Number(new URL(wda.origin).port)
      , connectPort: mjpegPort
      })
      wdaClient.setDisplay({height: 2532, width: 1170, scale: 3})
    })

    it('should not kill the session of an Appium test when the device is opened', async function() {
      state.active = 'appium'
      await wdaClient.client.startSession()
      expect(wdaClient.client.sessionId).to.equal('appium')
      expect(state.killed).to.eql([])

      await wdaClient.client.stopSession()
      expect(state.active).to.equal('appium')
      expect(state.calls).to.not.include('DELETE /session/appium')
    })

    it('should delete the session it created when the device is closed', async function() {
      await wdaClient.client.startSession()
      var own = wdaClient.client.sessionId
      expect(own).to.match(/^stf-/)

      await wdaClient.client.stopSession()
      expect(state.calls).to.include('DELETE /session/' + own)
      expect(state.active).to.equal(null)
    })

    it('should report the version, the status and the size of the device', async function() {
      state.active = 'appium'
      var size = await wdaClient.client.startSession()
      expect(size).to.eql({height: 844, width: 390})
      var sent = wdaClient.sent()
      var version = sent.find(function(entry) {
        return entry.type === 'SdkIosVersion'
      })
      expect(version!.message.sdkVersion).to.equal('18.2')
      expect(sent.some(function(entry) {
        return entry.type === 'DeviceStatusMessage' && entry.message.status === 3
      })).to.equal(true)
      expect(wdaClient.fatal).to.eql([])
    })
  })
})
