// Fork (Zebrunner): the settings of WDA that make the taps and the gestures of STF fast. WDA takes an
// accessibility snapshot of the app in front for every positioned action of /actions; it is cut
// to the root element by snapshotMaxDepth=1, and the actions do not wait for the app to be idle.
// Measured on an iPhone XR (iOS 18, WDA 11): a tap 1.4 s -> 0.4 s, a swipe of 6 moves 3.8 s -> 0.9 s.
// These settings are global in WDA and break the lookups of elements, so they are set only in the
// session STF creates itself (WDA resets them in every new session, an Appium test gets its own
// defaults), dropped for the automations that look for elements and restored when the session ends
import Promise from 'bluebird'

import logger from '../../../../util/logger.js'
import request from '../util/rp.js'
import type {WdaValueResponse} from '../../../../types/ios-device.js'

var log = logger.createLogger('wda:fast-input')

export var FAST_SETTINGS = {
  snapshotMaxDepth: 1
, waitForIdleTimeout: 0
, animationCoolOffTimeout: 0
}
// The values of WDA in a new session (FBConfiguration.resetSessionSettings)
export var DEFAULT_SETTINGS = {
  snapshotMaxDepth: 50
, waitForIdleTimeout: 10
, animationCoolOffTimeout: 2
}

type Settings = Record<string, number>

// The session of the unit that has the fast settings, null without one (one unit drives one device)
var current: {baseUrl: string, sessionId: string} | null = null

function post(baseUrl: string, sessionId: string, settings: Settings): Promise<boolean> {
  return request({
    method: 'POST'
  , uri: `${baseUrl}/session/${sessionId}/appium/settings`
  , body: {settings: settings}
  , json: true
  , timeout: 10000
  })
    .then(function() {
      return true
    })
    .catch(function(err: Error) {
      log.warn('Unable to change the settings of WDA: %s', err.message)
      return false
    })
}

function isFast(settings: Settings | undefined): boolean {
  return !!settings && Object.entries(FAST_SETTINGS).every(function([name, value]) {
    return settings[name] === value
  })
}

export function isFastInput(): boolean {
  return current !== null
}

// startFastInput <baseUrl> <sessionId> <created>: the fast settings for a session STF created;
// a session of somebody else keeps its settings, unless they are the fast ones that a session of
// STF left (the unit restarted), then they are restored when the session ends
export function startFastInput(
  baseUrl: string
, sessionId: string
, created: boolean
): Promise<void> {
  current = null
  if (created) {
    return post(baseUrl, sessionId, FAST_SETTINGS).then(function(done) {
      if (done) {
        current = {baseUrl: baseUrl, sessionId: sessionId}
        log.info('Fast input settings of WDA are on')
      }
    })
  }
  return request<WdaValueResponse<Settings>>({
    method: 'GET'
  , uri: `${baseUrl}/session/${sessionId}/appium/settings`
  , json: true
  , timeout: 10000
  })
    .then(function(response) {
      if (isFast(response.value)) {
        current = {baseUrl: baseUrl, sessionId: sessionId}
      }
    })
    .catch(function() {
      log.warn('Unable to read the settings of WDA')
    })
}

// stopFastInput: the default settings back, before the session ends
export function stopFastInput(): Promise<void> {
  var session = current
  current = null
  if (!session) {
    return Promise.resolve()
  }
  return post(session.baseUrl, session.sessionId, DEFAULT_SETTINGS).then(function() {
    log.info('Fast input settings of WDA are off')
  })
}

// withFullSnapshots <operation>: runs an operation that looks for elements with the default
// settings, then the fast ones are back if the session is still the same
export function withFullSnapshots<T>(operation: () => Promise<T> | T): Promise<T> {
  var session = current
  if (!session) {
    return Promise.try(operation)
  }
  var {baseUrl, sessionId} = session
  return post(baseUrl, sessionId, DEFAULT_SETTINGS)
    .then(operation)
    .finally(function() {
      return current === session ? post(baseUrl, sessionId, FAST_SETTINGS) : null
    })
}
