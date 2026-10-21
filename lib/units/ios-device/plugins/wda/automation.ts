import Promise from 'bluebird'

import request from '../util/rp.js'
import {withFullSnapshots} from './fast-input.js'
import type {RpOptions, WdaValueResponse} from '../../../../types/ios-device.js'

export var SETTINGS_BUNDLE_ID = 'com.apple.Preferences'
export var SPRINGBOARD_BUNDLE_ID = 'com.apple.springboard'
var ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'

interface WdaElement {
  ELEMENT?: string
  [ELEMENT_KEY]?: string
}

var KEYBOARD = 'type == \'XCUIElementTypeKeyboard\''

export interface WdaAutomationOptions {
  baseUrl: string
  // The WDA session of the unit, null while there is none
  sessionId(): string | null
  // How long to wait for an element
  waitTimeout?: number
  pollInterval?: number
  requestTimeout?: number
}

// wdaErrorMessage <err>: the message of an error of WDA without its traceback, for the UI
export function wdaErrorMessage(err: unknown): string {
  var body = (err as {error?: {value?: {message?: unknown}}}).error
  var message = body && typeof body === 'object' && typeof body.value?.message === 'string' ?
    body.value.message :
    (err as Error)?.message || String(err)
  message = message.split('\n')[0]!.split(' Original error:')[0]!.trim()
  return message.length > 200 ? message.slice(0, 197) + '...' : message
}

// The operations of the unit that switch the app in front run one at a time, whichever plugin
// starts them (one unit drives one device)
var queue: Promise<unknown> = Promise.resolve()

// Drives an iOS device through WDA the way a user does. The requests do not go through
// WdaClient.handleRequest, which stops the unit on an unexpected error of WDA; an error of WDA
// while a page changes (a stale element, kAXErrorInvalidUIElement) is retried until the timeout
export default class WdaAutomation {
  protected options: Required<WdaAutomationOptions>

  constructor(options: WdaAutomationOptions) {
    this.options = Object.assign({
      waitTimeout: 10000
    , pollInterval: 500
    , requestTimeout: 30000
    }, options)
  }

  // The fast input settings of WDA (fast-input.ts) cut the snapshots the lookups of elements
  // need, so an operation runs with the default ones
  protected serial<T>(operation: () => Promise<T>): Promise<T> {
    var full = function() {
      return withFullSnapshots(operation)
    }
    var next = queue.then(full, full)
    queue = next.catch(function() {
      return null
    })
    return next
  }

  protected session(path: string): string {
    var sessionId = this.options.sessionId()
    if (!sessionId) {
      throw new Error('The WebDriverAgent session is not ready')
    }
    return this.options.baseUrl + '/session/' + sessionId + path
  }

  protected send<T = unknown>(options: RpOptions): Promise<T> {
    return request<T>(Object.assign({json: true, timeout: this.options.requestTimeout}, options))
  }

  protected post<T = unknown>(path: string, body: object = {}): Promise<T> {
    return Promise.try(() => this.send<T>({method: 'POST', uri: this.session(path), body: body}))
  }

  protected activeApp(): Promise<string | null> {
    return this.send<WdaValueResponse<{bundleId?: string}>>({
      method: 'GET'
    , uri: this.options.baseUrl + '/wda/activeAppInfo'
    })
      .then(function(response) {
        return response.value?.bundleId || null
      })
      .catch(function() {
        return null
      })
  }

  // restore <bundleId> [keep]: brings back the app that was in front, the home screen when it is
  // not known; keep is an app that is left in front
  protected restore(bundleId: string | null, keep?: string): Promise<unknown> {
    return Promise.try(() => {
      if (bundleId && bundleId === keep) {
        return null
      }
      if (!bundleId || bundleId === SPRINGBOARD_BUNDLE_ID) {
        return this.send({method: 'POST', uri: this.options.baseUrl + '/wda/homescreen', body: {}})
      }
      return this.post('/wda/apps/activate', {bundleId: bundleId})
    })
      .catch(function() {
        return null
      })
  }

  protected unlock(): Promise<unknown> {
    return Promise.try(() => this.send<WdaValueResponse<boolean>>({
      method: 'GET'
    , uri: this.session('/wda/locked')
    }))
      .then((response) => {
        return response.value === true ? this.post('/wda/unlock') : null
      })
  }

  // findFirst <predicate>: the first element of the predicate, null without one (WDA stops looking
  // at the first match, unlike /elements that snapshots all of them)
  protected findFirst(predicate: string): Promise<string | null> {
    return this.post<WdaValueResponse<WdaElement>>('/element', {
      using: 'predicate string'
    , value: predicate
    })
      .then(function(response) {
        var element = response.value
        return element ? element[ELEMENT_KEY] || element.ELEMENT || null : null
      })
      .catch(function(err) {
        var body = (err as {error?: {value?: {error?: string}}}).error
        if (body && typeof body === 'object' && body.value?.error === 'no such element') {
          return null
        }
        throw err
      })
  }

  protected attribute(element: string, name: string): Promise<unknown> {
    return Promise.try(() => this.send<WdaValueResponse<unknown>>({
      method: 'GET'
    , uri: this.session('/element/' + element + '/attribute/' + name)
    }))
      .then(function(response) {
        return response.value
      })
  }

  // hasKeyboard [timeout]: whether the keyboard shows up, so a field of the app in front has the focus
  protected hasKeyboard(timeout: number): Promise<boolean> {
    return this.poll(() => this.findFirst(KEYBOARD), timeout).then(function(result) {
      return result.found !== null
    })
  }

  protected click(element: string): Promise<unknown> {
    return this.post('/element/' + element + '/click')
  }

  // poll <find> [timeout]: the first result of find that is not null, null after the timeout; an
  // error of find counts as nothing found, the last one is kept for the message of waitFor
  protected poll<T>(find: () => Promise<T | null>, timeout = this.options.waitTimeout): Promise<{
    found: T | null
    error: unknown
  }> {
    var deadline = Date.now() + timeout
    var error: unknown = null
    var attempt = (): Promise<{found: T | null, error: unknown}> => {
      return Promise.try(find)
        .catch(function(err) {
          if ((err as Error).message === 'The WebDriverAgent session is not ready') {
            throw err
          }
          error = err
          return null
        })
        .then((found) => {
          if (found !== null) {
            return {found: found, error: null}
          }
          if (Date.now() >= deadline) {
            return {found: null, error: error}
          }
          return Promise.delay(this.options.pollInterval).then(attempt)
        })
    }
    return attempt()
  }

  // waitFor <find> <message> [timeout]: the first result of find that is not null, fails with the
  // message (and the last error of WDA) after the timeout
  protected waitFor<T>(
    find: () => Promise<T | null>
  , message: string
  , timeout = this.options.waitTimeout
  ): Promise<T> {
    return this.poll(find, timeout).then(function(result) {
      if (result.found === null) {
        throw new Error(result.error ? message + ': ' + wdaErrorMessage(result.error) : message)
      }
      return result.found
    })
  }
}
