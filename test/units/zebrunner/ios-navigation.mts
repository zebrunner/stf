// Fork (Zebrunner): Back and Recents of the menu of the screen on iOS
// (lib/units/ios-device/plugins/wda/navigation.ts) against a fake WDA
import {expect} from 'chai'
import express from 'express'

import NavigationAutomation, {
  appSwitch
, hasHomeButton
, isWdaButton
, pressNavigationKey
, recentsPath
, screenSize
} from '../../../lib/units/ios-device/plugins/wda/navigation.js'
import iosutil from '../../../lib/units/ios-device/plugins/util/iosutil.js'
import type {IosPressButtonContext, WdaClientPlugin} from '../../../lib/types/ios-device.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

var SPRINGBOARD = 'com.apple.springboard'
var XR = {width: 414, height: 896}

interface FakeNavigation {
  // The first button of the navigation bar of the app in front, null without one
  navButton: {x: number, y: number, width: number, height: number} | null
  // "◀ <app>" in the status bar of SpringBoard
  breadcrumb: boolean
  settings: Record<string, unknown>
  // The settings when the breadcrumb was looked for
  lookupApp: unknown
  clicks: string[]
  actions: unknown[]
  buttons: string[]
  failLookups: boolean
}

function fakeWda(state: FakeNavigation) {
  var app = express()
  app.use(express.json())
  function noSuchElement(res: express.Response) {
    res.status(404).json({value: {error: 'no such element', message: 'unable to find an element'}})
  }
  app.post('/session/:id/element', function(req, res) {
    if (state.failLookups) {
      res.status(500).json({value: {error: 'unknown error', message: 'kAXErrorInvalidUIElement'}})
      return
    }
    var {using, value} = req.body
    if (using === 'class chain' && value.includes('NavigationBar') && state.navButton) {
      res.json({value: {ELEMENT: 'nav'}})
      return
    }
    if (using === 'accessibility id' && value === 'breadcrumb') {
      state.lookupApp = state.settings.defaultActiveApplication
      if (state.breadcrumb && state.settings.defaultActiveApplication === SPRINGBOARD) {
        res.json({value: {ELEMENT: 'breadcrumb'}})
        return
      }
    }
    noSuchElement(res)
  })
  app.get('/session/:id/element/nav/attribute/rect', function(req, res) {
    res.json({value: state.navButton})
  })
  app.post('/session/:id/element/:element/click', function(req, res) {
    state.clicks.push(req.params.element)
    res.json({value: null})
  })
  app.get('/session/:id/appium/settings', function(req, res) {
    res.json({value: state.settings})
  })
  app.post('/session/:id/appium/settings', function(req, res) {
    Object.assign(state.settings, req.body.settings)
    res.json({value: state.settings})
  })
  app.post('/session/:id/actions', function(req, res) {
    state.actions.push(req.body.actions)
    res.json({value: null})
  })
  app.post('/session/:id/wda/pressButton', function(req, res) {
    state.buttons.push(req.body.name)
    res.json({value: null})
  })
  return app
}

describe('zebrunner: iOS Back and Recents', function() {
  var server: Running
    , state: FakeNavigation
    , navigation: NavigationAutomation
    , width: number | null

  beforeEach(async function() {
    state = {
      navButton: null
    , breadcrumb: false
    , settings: {defaultActiveApplication: 'auto', snapshotMaxDepth: 50}
    , lookupApp: null
    , clicks: []
    , actions: []
    , buttons: []
    , failLookups: false
    }
    width = XR.width
    server = await listen(fakeWda(state))
    navigation = new NavigationAutomation({
      baseUrl: server.origin
    , sessionId: () => 's1'
    , screenWidth: () => width
    , waitTimeout: 100
    , pollInterval: 10
    })
  })

  afterEach(async function() {
    await server.close()
  })

  function client(values: Partial<WdaClientPlugin> = {}): WdaClientPlugin {
    return Object.assign({
      baseUrl: server.origin
    , sessionId: 's1'
    , deviceSize: XR
    , orientation: 'PORTRAIT'
    , deviceType: 'iPhone'
    , isSwiping: false
    }, values) as WdaClientPlugin
  }

  describe('Back', function() {
    it('should tap the back button of the navigation bar of the app', async function() {
      state.navButton = {x: 0, y: 48, width: 98, height: 44}
      state.breadcrumb = true
      expect(await navigation.back()).to.equal('navigation')
      expect(state.clicks).to.deep.equal(['nav'])
      expect(state.lookupApp).to.equal(null)
    })

    it('should go back to the app that opened this one without a back button', async function() {
      state.breadcrumb = true
      expect(await navigation.back()).to.equal('breadcrumb')
      expect(state.clicks).to.deep.equal(['breadcrumb'])
      expect(state.lookupApp).to.equal(SPRINGBOARD)
      expect(state.settings.defaultActiveApplication).to.equal('auto')
    })

    it('should not take a button on the right of the navigation bar for Back', async function() {
      state.navButton = {x: 340, y: 48, width: 60, height: 44}
      expect(await navigation.back()).to.equal(null)
      expect(state.clicks).to.deep.equal([])
      expect(state.settings.defaultActiveApplication).to.equal('auto')
    })

    it('should take the left side by the width of the screen in landscape', async function() {
      state.navButton = {x: 200, y: 0, width: 98, height: 32}
      expect(await navigation.back()).to.equal(null)
      width = XR.height
      expect(await navigation.back()).to.equal('navigation')
    })

    it('should do nothing without a back button and a way back to another app', async function() {
      expect(await navigation.back()).to.equal(null)
      expect(state.clicks).to.deep.equal([])
      expect(state.actions).to.deep.equal([])
    })

    it('should press Menu on Apple TV', async function() {
      await pressNavigationKey(client({deviceType: 'Apple TV'}), navigation, 'back')
      expect(state.buttons).to.deep.equal(['menu'])
    })

    it('should survive an error of WDA', async function() {
      state.failLookups = true
      await pressNavigationKey(client(), navigation, 'back')
      expect(state.clicks).to.deep.equal([])
      expect(state.settings.defaultActiveApplication).to.equal('auto')
    })
  })

  describe('Recents', function() {
    it('should swipe up from the bottom edge and hold', async function() {
      await pressNavigationKey(client(), navigation, 'app_switch')
      expect(state.actions).to.have.length(1)
      var [finger] = state.actions[0] as Array<{actions: unknown[]}>
      expect(finger!.actions).to.deep.equal([
        {type: 'pointerMove', duration: 0, x: 207, y: 895}
      , {type: 'pointerDown', button: 0}
      , {type: 'pointerMove', duration: 300, x: 207, y: 699}
      , {type: 'pointerMove', duration: 600, x: 207, y: 694}
      , {type: 'pointerUp', button: 0}
      ])
    })

    it('should swipe from the bottom of the screen in landscape', function() {
      var screen = screenSize(XR, 'LANDSCAPE')
      expect(screen).to.deep.equal({width: 896, height: 414})
      expect(recentsPath(screen)[0]).to.deep.equal({x: 448, y: 413, t: 0})
    })

    it('should press Home twice on an iPhone with the Home button', async function() {
      expect(hasHomeButton({width: 375, height: 667})).to.equal(true)
      expect(hasHomeButton({width: 414, height: 736})).to.equal(true)
      expect(hasHomeButton(XR)).to.equal(false)
      expect(hasHomeButton({width: 820, height: 1180})).to.equal(false)
      await appSwitch(client({deviceSize: {width: 375, height: 667}}))
      expect(state.buttons).to.deep.equal(['home', 'home'])
      expect(state.actions).to.deep.equal([])
    })

    it('should skip Apple TV and a running gesture', async function() {
      await pressNavigationKey(client({deviceType: 'Apple TV'}), navigation, 'app_switch')
      await pressNavigationKey(client({isSwiping: true}), navigation, 'app_switch')
      expect(state.actions).to.deep.equal([])
      expect(state.buttons).to.deep.equal([])
    })
  })

  describe('the buttons of WDA', function() {
    it('should press only the buttons the device has', function() {
      var pressed: string[] = []
      var context = {
        deviceType: 'iPhone'
      , pressButton: (name: string) => pressed.push(name)
      } as unknown as IosPressButtonContext
      iosutil.pressButton.call(context, 'volume_up')
      iosutil.pressButton.call(context, 'back')
      iosutil.pressButton.call(context, 'menu')
      iosutil.pressButton.call(context, 'enter')
      expect(pressed).to.deep.equal(['volumeUp'])
      expect(isWdaButton('select', 'Apple TV')).to.equal(true)
      expect(isWdaButton('select', 'iPhone')).to.equal(false)
    })
  })
})
