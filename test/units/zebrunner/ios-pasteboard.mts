// Fork (Zebrunner): the clipboard of an iOS device (lib/units/ios-device/plugins/wda/pasteboard.ts)
// against a fake WDA that, like iOS 16+, reads and writes the pasteboard only with its runner in front
import {expect} from 'chai'
import express from 'express'

import PasteboardAutomation, {
  runnerBundleId
} from '../../../lib/units/ios-device/plugins/wda/pasteboard.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

var RUNNER = 'com.facebook.WebDriverAgentRunner.xctrunner'

interface FakePasteboard {
  active: string
  pasteboard: string
  // The text typed into the focused field of the app in front, null without one
  field: string | null
  settings: Record<string, number>
  // The settings of WDA when its runner came to the front
  runnerSettings: Record<string, number> | null
  calls: string[]
}

function fakeWda(state: FakePasteboard) {
  var app = express()
  app.use(express.json())
  app.use(function(req, res, next) {
    state.calls.push(req.method + ' ' + req.path.replace(/^\/session\/[^/]+/, ''))
    next()
  })
  app.get('/status', function(req, res) {
    res.json({value: {build: {productBundleIdentifier: 'com.facebook.WebDriverAgentRunner'}}})
  })
  app.get('/wda/activeAppInfo', function(req, res) {
    res.json({value: {bundleId: state.active}})
  })
  app.post('/wda/homescreen', function(req, res) {
    state.active = 'com.apple.springboard'
    res.json({value: null})
  })
  app.get('/session/:id/appium/settings', function(req, res) {
    res.json({value: Object.assign({snapshotMaxDepth: 50}, state.settings)})
  })
  app.post('/session/:id/appium/settings', function(req, res) {
    Object.assign(state.settings, req.body.settings)
    res.json({value: state.settings})
  })
  app.post('/session/:id/wda/apps/activate', function(req, res) {
    if (req.body.bundleId === RUNNER) {
      state.runnerSettings = Object.assign({}, state.settings)
    }
    state.active = req.body.bundleId
    res.json({value: null})
  })
  app.post('/session/:id/wda/getPasteboard', function(req, res) {
    var text = state.active === RUNNER ? state.pasteboard : ''
    res.json({value: Buffer.from(text).toString('base64')})
  })
  app.post('/session/:id/wda/setPasteboard', function(req, res) {
    if (state.active === RUNNER) {
      state.pasteboard = Buffer.from(req.body.content, 'base64').toString()
    }
    res.json({value: null})
  })
  app.post('/session/:id/element', function(req, res) {
    if (String(req.body.value).includes('XCUIElementTypeKeyboard') && state.field !== null &&
      state.active !== RUNNER) {
      res.json({value: {ELEMENT: 'keyboard'}})
      return
    }
    res.status(404).json({value: {error: 'no such element', message: 'unable to find an element'}})
  })
  app.post('/session/:id/wda/keys', function(req, res) {
    if (state.field === null || state.active === RUNNER) {
      res.status(400).json({value: {error: 'invalid element state', message: 'No keyboard'}})
      return
    }
    state.field += req.body.value.join('')
    res.json({value: null})
  })
  return app
}

describe('zebrunner: ios-device clipboard', function() {
  var server: Running
   , state: FakePasteboard
   , sessionId: string | null

  function pasteboard() {
    return new PasteboardAutomation({
      baseUrl: server.origin
    , sessionId: function() {
        return sessionId
      }
    , pollInterval: 20
    , keyboardTimeout: 200
    })
  }

  beforeEach(async function() {
    sessionId = 'stf-1'
    state = {
      active: 'com.example.app'
    , pasteboard: 'copied on the device'
    , field: ''
    , settings: {waitForIdleTimeout: 10, animationCoolOffTimeout: 2}
    , runnerSettings: null
    , calls: []
    }
    server = await listen(fakeWda(state))
  })

  afterEach(async function() {
    await server.close()
  })

  it('should read the pasteboard with the runner of WDA in front for a moment', async function() {
    expect(await pasteboard().get()).to.equal('copied on the device')
    expect(state.active).to.equal('com.example.app')
    expect(state.calls).to.include('POST /wda/apps/activate')
  })

  // XCTest waits up to half a minute for the runner to be idle when it comes to the front
  it('should not wait for the runner to be idle and restore the settings', async function() {
    await pasteboard().get()
    expect(state.runnerSettings).to.deep.equal({waitForIdleTimeout: 0, animationCoolOffTimeout: 0})
    expect(state.settings).to.deep.equal({waitForIdleTimeout: 10, animationCoolOffTimeout: 2})
  })

  it('should paste like Android: into the pasteboard and the focused field', async function() {
    expect(await pasteboard().paste('pasted text')).to.equal(true)
    expect(state.pasteboard).to.equal('pasted text')
    expect(state.field).to.equal('pasted text')
    expect(state.active).to.equal('com.example.app')
  })

  it('should only fill the pasteboard without a focused field', async function() {
    state.field = null
    expect(await pasteboard().paste('pasted text')).to.equal(false)
    expect(state.pasteboard).to.equal('pasted text')
    expect(state.calls).to.not.include('POST /wda/keys')
  })

  // The app comes back with the waits of WDA, so the text goes to it and not to the runner
  it('should restore the settings of WDA before it brings back the app', async function() {
    await pasteboard().paste('pasted text')
    var restoreSettings = state.calls.lastIndexOf('POST /appium/settings')
    var activations = state.calls.reduce(function(indexes: number[], call, index) {
      return call === 'POST /wda/apps/activate' ? indexes.concat(index) : indexes
    }, [])
    expect(activations).to.have.length(2)
    expect(restoreSettings).to.be.below(activations[1]!)
  })

  it('should go back to the home screen when it was in front', async function() {
    state.active = 'com.apple.springboard'
    await pasteboard().get()
    expect(state.calls).to.include('POST /wda/homescreen')
    expect(state.active).to.equal('com.apple.springboard')
  })

  it('should fail without a WDA session', async function() {
    sessionId = null
    try {
      await pasteboard().get()
      throw new Error('get should have failed')
    }
    catch (err) {
      expect((err as Error).message).to.equal('The WebDriverAgent session is not ready')
    }
  })

  it('should know the bundle of the runner of WDA', function() {
    expect(runnerBundleId({build: {productBundleIdentifier: 'com.facebook.WebDriverAgentRunner'}}))
      .to.equal(RUNNER)
    expect(runnerBundleId({build: {productBundleIdentifier: 'com.acme.wda.xctrunner'}}))
      .to.equal('com.acme.wda.xctrunner')
    expect(runnerBundleId({})).to.equal(RUNNER)
  })
})
