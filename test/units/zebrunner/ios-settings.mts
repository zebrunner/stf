// Fork (Zebrunner): Wi-Fi and Bluetooth of an iOS device, switched in its Settings app through WDA
// (lib/units/ios-device/plugins/wda/settings.ts), against a fake WDA that models the pages of Settings
import {expect} from 'chai'
import express from 'express'

import SettingsAutomation, {
  cellPredicate
, switchPredicate
} from '../../../lib/units/ios-device/plugins/wda/settings.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

interface FakeSettings {
  active: string
  locked: boolean
  page: 'none' | 'root' | 'wifi' | 'bluetooth'
  wifi: boolean
  bluetooth: boolean
  // The labels of the cells (localized), null hides the cell (a simulator has no Wi-Fi)
  wifiLabel: string | null
  bluetoothLabel: string | null
  // The label of the switch of the Wi-Fi page, the label of the item by default
  wifiSwitchLabel?: string
  calls: string[]
}

function fakeSettings(state: FakeSettings) {
  var app = express()
  app.use(express.json())
  app.use(function(req, res, next) {
    state.calls.push(req.method + ' ' + req.path.replace(/^\/session\/[^/]+/, ''))
    next()
  })
  app.get('/wda/activeAppInfo', function(req, res) {
    res.json({value: {bundleId: state.active}})
  })
  app.post('/wda/homescreen', function(req, res) {
    state.active = 'com.apple.springboard'
    res.json({value: null})
  })
  app.get('/session/:id/wda/locked', function(req, res) {
    res.json({value: state.locked})
  })
  app.post('/session/:id/wda/unlock', function(req, res) {
    state.locked = false
    res.json({value: null})
  })
  app.post('/session/:id/wda/apps/terminate', function(req, res) {
    if (state.active === req.body.bundleId) {
      state.page = 'none'
    }
    res.json({value: true})
  })
  app.post('/session/:id/wda/apps/launch', function(req, res) {
    state.active = req.body.bundleId
    state.page = 'root'
    res.json({value: null})
  })
  app.post('/session/:id/wda/apps/activate', function(req, res) {
    state.active = req.body.bundleId
    res.json({value: null})
  })
  app.post('/session/:id/elements', function(req, res) {
    var predicate = String(req.body.value)
    var found: string[] = []
    if (state.active === 'com.apple.Preferences' && predicate.includes('XCUIElementTypeCell') &&
      state.page === 'root') {
      if (predicate.includes('\'WIFI\'') && state.wifiLabel) {
        found.push('wifi-cell')
      }
      if (predicate.includes('\'Bluetooth\'') && state.bluetoothLabel) {
        found.push('bluetooth-cell')
      }
    }
    if (predicate.includes('XCUIElementTypeSwitch')) {
      var wifiSwitch = state.wifiSwitchLabel || state.wifiLabel
      if (state.page === 'wifi' && predicate.includes('\'' + wifiSwitch + '\'')) {
        found.push('wifi-switch')
      }
      if (state.page === 'bluetooth' && predicate.includes('\'' + state.bluetoothLabel + '\'')) {
        found.push('bluetooth-switch')
      }
    }
    res.json({value: found.map(function(id) {
      return {ELEMENT: id, 'element-6066-11e4-a52e-4f735466cecf': id}
    })})
  })
  app.get('/session/:id/element/:element/attribute/:name', function(req, res) {
    var element = req.params.element
    if (req.params.name === 'label') {
      res.json({value: element === 'wifi-cell' ? state.wifiLabel : state.bluetoothLabel})
    }
    else if (element === 'wifi-switch') {
      res.json({value: state.wifi ? '1' : '0'})
    }
    else {
      res.json({value: state.bluetooth ? '1' : '0'})
    }
  })
  app.post('/session/:id/element/:element/click', function(req, res) {
    switch (req.params.element) {
      case 'wifi-cell':
        state.page = 'wifi'
        break
      case 'bluetooth-cell':
        state.page = 'bluetooth'
        break
      case 'wifi-switch':
        state.wifi = !state.wifi
        break
      case 'bluetooth-switch':
        state.bluetooth = !state.bluetooth
        break
    }
    res.json({value: null})
  })
  return app
}

describe('zebrunner: ios-device Wi-Fi and Bluetooth through Settings', function() {
  var server: Running
   , state: FakeSettings
   , sessionId: string | null

  function automation() {
    return new SettingsAutomation({
      baseUrl: server.origin
    , sessionId: function() {
        return sessionId
      }
    , waitTimeout: 300
    , pollInterval: 20
    })
  }

  beforeEach(async function() {
    sessionId = 'stf-1'
    state = {
      active: 'com.example.app'
    , locked: false
    , page: 'none'
    , wifi: true
    , bluetooth: false
    , wifiLabel: 'Wi-Fi'
    , bluetoothLabel: 'Bluetooth'
    , calls: []
    }
    server = await listen(fakeSettings(state))
  })

  afterEach(async function() {
    await server.close()
  })

  it('should read the state and bring back the app that was in front', async function() {
    expect(await automation().isEnabled('wifi')).to.equal(true)
    expect(await automation().isEnabled('bluetooth')).to.equal(false)
    expect(state.active).to.equal('com.example.app')
    expect(state.calls).to.not.include('POST /element/wifi-switch/click')
  })

  it('should open Settings on its root page and unlock the device first', async function() {
    state.locked = true
    state.active = 'com.apple.Preferences'
    state.page = 'bluetooth'
    expect(await automation().isEnabled('wifi')).to.equal(true)
    expect(state.locked).to.equal(false)
    expect(state.calls.indexOf('POST /wda/apps/terminate'))
      .to.be.below(state.calls.indexOf('POST /wda/apps/launch'))
    // Settings was in front, it stays
    expect(state.calls).to.not.include('POST /wda/apps/activate')
  })

  it('should turn a radio off and on', async function() {
    expect(await automation().setEnabled('wifi', false)).to.equal(false)
    expect(state.wifi).to.equal(false)
    expect(await automation().setEnabled('bluetooth', true)).to.equal(true)
    expect(state.bluetooth).to.equal(true)
    expect(state.active).to.equal('com.example.app')
  })

  it('should not tap a switch that is already in the state', async function() {
    expect(await automation().setEnabled('wifi', true)).to.equal(true)
    expect(state.calls).to.not.include('POST /element/wifi-switch/click')
  })

  it('should go back to the home screen when it was in front', async function() {
    state.active = 'com.apple.springboard'
    await automation().setEnabled('bluetooth', true)
    expect(state.calls).to.include('POST /wda/homescreen')
    expect(state.active).to.equal('com.apple.springboard')
  })

  it('should find the switch by the localized label of the cell', async function() {
    state.wifiLabel = 'Wi-Fi-Netz'
    expect(await automation().setEnabled('wifi', false)).to.equal(false)
    expect(state.wifi).to.equal(false)
  })

  it('should find the switch by the label of an item that ends with its value', async function() {
    state.wifiLabel = 'Wi-Fi-Netz, Aus'
    state.wifiSwitchLabel = 'Wi-Fi-Netz'
    expect(await automation().setEnabled('wifi', false)).to.equal(false)
    expect(state.wifi).to.equal(false)
  })

  it('should fail when Settings has no such item and still bring back the app', async function() {
    state.wifiLabel = null
    try {
      await automation().isEnabled('wifi')
      throw new Error('isEnabled should have failed')
    }
    catch (err) {
      expect((err as Error).message).to.equal('Settings has no Wi-Fi item')
    }
    expect(state.active).to.equal('com.example.app')
  })

  it('should fail without a WDA session', async function() {
    sessionId = null
    try {
      await automation().setEnabled('wifi', false)
      throw new Error('setEnabled should have failed')
    }
    catch (err) {
      expect((err as Error).message).to.equal('The WebDriverAgent session is not ready')
    }
    expect(state.wifi).to.equal(true)
  })

  it('should run one switch at a time', async function() {
    var settings = automation()
    var results = await Promise.all([
      settings.setEnabled('wifi', false)
    , settings.setEnabled('bluetooth', true)
    ])
    expect(results).to.deep.equal([false, true])
    var launches = state.calls.reduce(function(indexes: number[], call, index) {
      return call === 'POST /wda/apps/launch' ? indexes.concat(index) : indexes
    }, [])
    expect(launches).to.have.length(2)
    // the second one starts after the first brought back the app
    expect(state.calls.slice(launches[0], launches[1])).to.include('POST /wda/apps/activate')
  })

  it('should find the items of iOS 17 and 18 and quote the labels', function() {
    expect(cellPredicate('bluetooth')).to.equal(
      '(type == \'XCUIElementTypeCell\' OR type == \'XCUIElementTypeButton\') AND' +
      ' (name IN {\'Bluetooth\', \'com.apple.settings.bluetooth\'}' +
      ' OR label == \'Bluetooth\' OR label BEGINSWITH \'Bluetooth, \')'
    )
    expect(cellPredicate('wifi')).to.include(' OR label BEGINSWITH \'WLAN, \')')
    expect(switchPredicate('bluetooth', 'Blue\'tooth, Off')).to.equal(
      'type == \'XCUIElementTypeSwitch\' AND' +
      ' (name IN {\'Bluetooth\', \'com.apple.settings.bluetooth\'}' +
      ' OR label IN {\'Bluetooth\', \'Blue\\\'tooth\'})'
    )
    expect(switchPredicate('wifi', 'WLAN'))
      .to.include('label IN {\'Wi-Fi\', \'Wi\u2011Fi\', \'WLAN\'}')
  })
})
