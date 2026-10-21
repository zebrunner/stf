// Fork (Zebrunner): Back and Recents of the menu of the screen on iOS, which has no such buttons;
// WDA failed on them ("The button 'back' is not supported") and the unit stopped
import Promise from 'bluebird'

import logger from '../../../../util/logger.js'
import request from '../util/rp.js'
import WdaAutomation, {SPRINGBOARD_BUNDLE_ID, type WdaAutomationOptions} from './automation.js'
import {replayDevicePaths, type PathPoint} from './gesture.js'
import type {
  IosDeviceSize
, IosOrientation
, WdaClientPlugin
, WdaValueResponse
} from '../../../../types/ios-device.js'

var log = logger.createLogger('wda:navigation')

// The buttons WDA presses (XCUIDevice), any other one fails
var IOS_BUTTONS = ['home', 'volumeup', 'volumedown']
var TVOS_BUTTONS = ['home', 'up', 'down', 'left', 'right', 'menu', 'select', 'playpause']

// The first button of a navigation bar; it is the back button when it is on the left of the screen
// (named by the title of the page it goes back to, "BackButton" only in UIKit)
var NAVIGATION_BUTTON = '**/XCUIElementTypeNavigationBar/XCUIElementTypeButton'
var LEFT_SIDE = 1 / 3
// "◀ <app>" in the status bar when an app was opened from another one, a button of SpringBoard
var BREADCRUMB = 'breadcrumb'

// Recents: a swipe up from the bottom edge that stops at RECENTS_STOP of the height and holds there
// while it still moves a little; it goes home when it stops higher or does not hold
var RECENTS_STOP = 0.78
var RECENTS_HOLD = 0.775
var RECENTS_SWIPE = 300
var RECENTS_DURATION = 900

var BACK_RESULTS: Record<string, string> = {
  navigation: 'the back button of the app'
, breadcrumb: 'to the app that opened this one'
, null: 'nothing to go back to'
}

export type NavigationKey = 'back' | 'app_switch'
export type BackResult = 'navigation' | 'breadcrumb' | null

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function isNavigationKey(key: string): key is NavigationKey {
  return key === 'back' || key === 'app_switch'
}

// isWdaButton <name> <deviceType>: whether WDA can press the button of the device
export function isWdaButton(name: string, deviceType: string | null): boolean {
  return (deviceType === 'Apple TV' ? TVOS_BUTTONS : IOS_BUTTONS).includes(name.toLowerCase())
}

// screenSize <size> <orientation>: the size of the screen in the points of WDA in the orientation
export function screenSize(
  size: IosDeviceSize
, orientation: IosOrientation | null
): IosDeviceSize {
  var portrait = {
    width: Math.min(size.width, size.height)
  , height: Math.max(size.width, size.height)
  }
  return String(orientation).includes('LANDSCAPE') ?
    {width: portrait.height, height: portrait.width} :
    portrait
}

// hasHomeButton <size>: an iPhone with the Home button (16:9 screen); the iPhones without it and
// all the iPads open Recents with a swipe up
export function hasHomeButton(size: IosDeviceSize | null): boolean {
  if (!size || !size.width || !size.height) {
    return false
  }
  var ratio = Math.max(size.width, size.height) / Math.min(size.width, size.height)
  return ratio > 1.6 && ratio < 1.9
}

// recentsPath <screen>: the swipe that opens Recents, in the points of WDA
export function recentsPath(screen: IosDeviceSize): PathPoint[] {
  var x = Math.round(screen.width / 2)
  return [
    {x: x, y: Math.round(screen.height) - 1, t: 0}
  , {x: x, y: Math.round(screen.height * RECENTS_STOP), t: RECENTS_SWIPE}
  , {x: x, y: Math.round(screen.height * RECENTS_HOLD), t: RECENTS_DURATION}
  ]
}

export interface NavigationAutomationOptions extends WdaAutomationOptions {
  // The width of the screen in the points of WDA in the current orientation, null when unknown
  screenWidth(): number | null
}

// Back the way a user goes back on iOS: the back button of the navigation bar of the app in front,
// else the "◀ <app>" of the status bar to the app that opened it, else nothing (a swipe from the
// edge may do something else in an app without a navigation)
export default class NavigationAutomation extends WdaAutomation {
  private screenWidth: () => number | null

  constructor(options: NavigationAutomationOptions) {
    super(options)
    this.screenWidth = options.screenWidth
  }

  back(): Promise<BackResult> {
    return this.serial(() => this.backButton().then((button): Promise<BackResult> => {
      if (button) {
        return this.click(button).then(() => 'navigation' as const)
      }
      return this.inSpringboard(() => this.find('accessibility id', BREADCRUMB))
        .then((breadcrumb) => {
          return breadcrumb ? this.click(breadcrumb).then(() => 'breadcrumb' as const) : null
        })
    }))
  }

  private backButton(): Promise<string | null> {
    return this.find('class chain', NAVIGATION_BUTTON).then((button) => {
      var width = this.screenWidth()
      if (!button || !width) {
        return null
      }
      var left = width * LEFT_SIDE
      return this.attribute(button, 'rect').then(function(value) {
        var rect = value as Rect
        return rect.x + rect.width / 2 < left ? button : null
      })
    })
  }

  // inSpringboard <action>: looks for elements in SpringBoard instead of the app in front
  private inSpringboard<T>(action: () => Promise<T>): Promise<T> {
    var saved: unknown = 'auto'
    return Promise.try(() => this.send<WdaValueResponse<Record<string, unknown>>>({
      method: 'GET'
    , uri: this.session('/appium/settings')
    }))
      .then((response) => {
        saved = response.value?.defaultActiveApplication ?? saved
        return this.post('/appium/settings', {
          settings: {defaultActiveApplication: SPRINGBOARD_BUNDLE_ID}
        })
      })
      .then(action)
      .finally(() => {
        return this.post('/appium/settings', {settings: {defaultActiveApplication: saved}})
          .catch(function() {
            return null
          })
      })
  }
}

function pressButton(wdaClient: WdaClientPlugin, name: string): Promise<unknown> {
  return request({
    method: 'POST'
  , uri: `${wdaClient.baseUrl}/session/${wdaClient.sessionId}/wda/pressButton`
  , body: {name: name}
  , json: true
  })
}

// appSwitch <wdaClient>: Recents (the App Switcher), two presses of Home on an iPhone with it
export function appSwitch(wdaClient: WdaClientPlugin): Promise<unknown> {
  if (!wdaClient.sessionId || !wdaClient.deviceSize) {
    return Promise.resolve()
  }
  if (wdaClient.deviceType === 'Apple TV') {
    log.warn('Recents is not supported on Apple TV')
    return Promise.resolve()
  }
  if (hasHomeButton(wdaClient.deviceSize)) {
    return pressButton(wdaClient, 'home').then(() => pressButton(wdaClient, 'home'))
  }
  var screen = screenSize(wdaClient.deviceSize, wdaClient.orientation)
  return replayDevicePaths(wdaClient, [recentsPath(screen)])
}

// pressNavigationKey <wdaClient> <navigation> <key>: Back or Recents; an error of WDA is logged,
// it does not stop the unit
export function pressNavigationKey(
  wdaClient: WdaClientPlugin
, navigation: NavigationAutomation
, key: NavigationKey
): Promise<unknown> {
  var done: Promise<unknown>
  if (key === 'app_switch') {
    done = appSwitch(wdaClient)
  }
  else if (wdaClient.deviceType === 'Apple TV') {
    done = pressButton(wdaClient, 'menu')
  }
  else {
    done = navigation.back().then(function(result) {
      log.info('Back: %s', BACK_RESULTS[String(result)])
    })
  }
  return done.catch(function(err: Error) {
    log.warn('Unable to press %s: %s', key, err.message)
  })
}
