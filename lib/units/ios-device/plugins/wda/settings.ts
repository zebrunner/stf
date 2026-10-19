import Promise from 'bluebird'

import request from '../util/rp.js'
import type {RpOptions, WdaValueResponse} from '../../../../types/ios-device.js'

export type IosRadio = 'wifi' | 'bluetooth'

export var SETTINGS_BUNDLE_ID = 'com.apple.Preferences'
var SPRINGBOARD_BUNDLE_ID = 'com.apple.springboard'
var ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'

// The items of the root page of Settings and the switches of their pages. The items are cells
// named WIFI and Bluetooth up to iOS 17, buttons named com.apple.settings.wifi and
// com.apple.settings.bluetooth from iOS 18 on (Settings in SwiftUI), their labels may end with the
// value (", Off"). The identifiers do not depend on the language, the labels are the English and
// the German/Chinese ("WLAN") ones; the switch is also found by the label of the item, which is
// localized the same way
var RADIOS: Record<IosRadio, {ids: string[], labels: string[]}> = {
  wifi: {
    ids: ['WIFI', 'com.apple.settings.wifi']
  , labels: ['Wi-Fi', 'Wi\u2011Fi', 'WLAN']
  }
, bluetooth: {
    ids: ['Bluetooth', 'com.apple.settings.bluetooth']
  , labels: ['Bluetooth']
  }
}

interface WdaElement {
  ELEMENT?: string
  [ELEMENT_KEY]?: string
}

export interface SettingsAutomationOptions {
  baseUrl: string
  // The WDA session of the unit, null while there is none
  sessionId(): string | null
  // How long to wait for a page of Settings
  waitTimeout?: number
  pollInterval?: number
  requestTimeout?: number
}

function quote(value: string): string {
  return '\'' + value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'') + '\''
}

function predicateList(values: string[]): string {
  return '{' + values.map(quote).join(', ') + '}'
}

export function cellPredicate(radio: IosRadio): string {
  var spec = RADIOS[radio]
  var labels = spec.labels.map(function(label) {
    return 'label == ' + quote(label) + ' OR label BEGINSWITH ' + quote(label + ', ')
  })
  return '(type == \'XCUIElementTypeCell\' OR type == \'XCUIElementTypeButton\') AND (name IN ' +
    predicateList(spec.ids) + ' OR ' + labels.join(' OR ') + ')'
}

// switchPredicate <radio> <itemLabel>: the switch of the page of the radio, also by the label of
// its item without the value
export function switchPredicate(radio: IosRadio, itemLabel: string | null): string {
  var spec = RADIOS[radio]
  var labels = spec.labels.slice()
  var own = itemLabel ? itemLabel.split(', ')[0]! : ''
  if (own && !labels.includes(own)) {
    labels.push(own)
  }
  return 'type == \'XCUIElementTypeSwitch\' AND (name IN ' + predicateList(spec.ids) +
    ' OR label IN ' + predicateList(labels) + ')'
}

function isOn(value: unknown): boolean {
  return value === '1' || value === 1 || value === true || value === 'true'
}

// Turns Wi-Fi and Bluetooth on and off the way a user does: opens their page of Settings through
// WDA, reads or taps the switch, then brings back the app that was in front. iOS has no API for it
// without MDM. The requests do not go through WdaClient.handleRequest, which stops the unit on an
// unexpected error of WDA
export default class SettingsAutomation {
  private options: Required<SettingsAutomationOptions>
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: SettingsAutomationOptions) {
    this.options = Object.assign({
      waitTimeout: 10000
    , pollInterval: 500
    , requestTimeout: 30000
    }, options)
  }

  // isEnabled <radio>: whether the switch of the radio is on
  isEnabled(radio: IosRadio): Promise<boolean> {
    return this.serial(() => this.onPage(radio, (element) => this.switchValue(element)))
  }

  // setEnabled <radio> <enabled>: turns the switch of the radio on or off, resolves with its state
  setEnabled(radio: IosRadio, enabled: boolean): Promise<boolean> {
    return this.serial(() => this.onPage(radio, (element) => this.turn(element, enabled)))
  }

  private turn(element: string, enabled: boolean): Promise<boolean> {
    var changed = (value: boolean) => (value === enabled ? value : null)
    return this.switchValue(element).then((current) => {
      if (current === enabled) {
        return current
      }
      return this.click(element).then(() => this.waitFor(
        () => this.switchValue(element).then(changed)
      , 'The switch did not turn ' + (enabled ? 'on' : 'off')
      ))
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    var next = this.queue.then(operation, operation)
    this.queue = next.catch(function() {
      return null
    })
    return next
  }

  private session(path: string): string {
    var sessionId = this.options.sessionId()
    if (!sessionId) {
      throw new Error('The WebDriverAgent session is not ready')
    }
    return this.options.baseUrl + '/session/' + sessionId + path
  }

  private send<T = unknown>(options: RpOptions): Promise<T> {
    return request<T>(Object.assign({json: true, timeout: this.options.requestTimeout}, options))
  }

  private onPage<T>(radio: IosRadio, action: (element: string) => Promise<T>): Promise<T> {
    var previous: string | null = null
    var name = radio === 'wifi' ? 'Wi-Fi' : 'Bluetooth'

    return Promise.try(() => this.activeApp())
      .then((bundleId) => {
        previous = bundleId
        return this.unlock()
      })
      .then(() => this.openSettings())
      .then(() => this.waitFor(
        () => this.findFirst(cellPredicate(radio))
      , 'Settings has no ' + name + ' item'
      ))
      .then((cell) => this.attribute(cell, 'label')
        .then((label) => this.click(cell).then(() => label)))
      .then((label) => this.waitFor(
        () => this.findFirst(switchPredicate(radio, typeof label === 'string' ? label : null))
      , 'The page of ' + name + ' has no switch'
      ))
      .then(action)
      .finally(() => this.restore(previous))
  }

  private click(element: string): Promise<unknown> {
    return this.send({
      method: 'POST'
    , uri: this.session('/element/' + element + '/click')
    , body: {}
    })
  }

  private activeApp(): Promise<string | null> {
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

  private unlock(): Promise<unknown> {
    return this.send<WdaValueResponse<boolean>>({method: 'GET', uri: this.session('/wda/locked')})
      .then((response) => {
        if (response.value === true) {
          return this.send({method: 'POST', uri: this.session('/wda/unlock'), body: {}})
        }
        return null
      })
  }

  // Settings opens on its last page, so it is started again to open on the root page
  private openSettings(): Promise<unknown> {
    var body = {bundleId: SETTINGS_BUNDLE_ID}
    return this.send({method: 'POST', uri: this.session('/wda/apps/terminate'), body: body})
      .catch(function() {
        return null
      })
      .then(() => this.send({method: 'POST', uri: this.session('/wda/apps/launch'), body: body}))
  }

  private restore(bundleId: string | null): Promise<unknown> {
    return Promise.try(() => {
      if (!bundleId || bundleId === SETTINGS_BUNDLE_ID) {
        return null
      }
      if (bundleId === SPRINGBOARD_BUNDLE_ID) {
        return this.send({method: 'POST', uri: this.options.baseUrl + '/wda/homescreen', body: {}})
      }
      return this.send({
        method: 'POST'
      , uri: this.session('/wda/apps/activate')
      , body: {bundleId: bundleId}
      })
    })
      .catch(function() {
        return null
      })
  }

  private findFirst(predicate: string): Promise<string | null> {
    return this.send<WdaValueResponse<WdaElement[]>>({
      method: 'POST'
    , uri: this.session('/elements')
    , body: {using: 'predicate string', value: predicate}
    })
      .then(function(response) {
        var element = (response.value || [])[0]
        return element ? element[ELEMENT_KEY] || element.ELEMENT || null : null
      })
  }

  private attribute(element: string, name: string): Promise<unknown> {
    return this.send<WdaValueResponse<unknown>>({
      method: 'GET'
    , uri: this.session('/element/' + element + '/attribute/' + name)
    })
      .then(function(response) {
        return response.value
      })
  }

  private switchValue(element: string): Promise<boolean> {
    return this.attribute(element, 'value').then(isOn)
  }

  private waitFor<T>(find: () => Promise<T | null>, message: string): Promise<T> {
    var deadline = Date.now() + this.options.waitTimeout
    var poll = (): Promise<T> => {
      return find().then((found) => {
        if (found !== null) {
          return found
        }
        if (Date.now() >= deadline) {
          throw new Error(message)
        }
        return Promise.delay(this.options.pollInterval).then(poll)
      })
    }
    return poll()
  }
}
