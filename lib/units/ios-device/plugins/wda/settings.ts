import Promise from 'bluebird'

import WdaAutomation, {SETTINGS_BUNDLE_ID, type WdaAutomationOptions} from './automation.js'

export {SETTINGS_BUNDLE_ID}

export type IosRadio = 'wifi' | 'bluetooth'
export type IosSettingsPage = 'wifi' | 'bluetooth' | 'storage' | 'developer'

interface ItemSpec {
  name: string
  ids: string[]
  labels: string[]
  // Low on its page: the page is scrolled until it shows up
  far?: boolean
}

// The items of the pages of Settings. They are cells named WIFI, Bluetooth, ... up to iOS 17,
// buttons named com.apple.settings.<item> from iOS 18 on (Settings in SwiftUI), and their labels may
// end with the value (", Off"). The identifiers do not depend on the language, the labels are the
// English and the German/Chinese ("WLAN") ones; a switch is also found by the label of its item,
// which is localized the same way. The cells of the inner pages are named by their label up to
// iOS 18, com.apple.settings.<page>.<item> from iOS 26 on (a simulator has no Storage)
var ITEMS: Record<'wifi' | 'bluetooth' | 'general' | 'storage' | 'developer', ItemSpec> = {
  wifi: {
    name: 'Wi-Fi'
  , ids: ['WIFI', 'com.apple.settings.wifi']
  , labels: ['Wi-Fi', 'Wi\u2011Fi', 'WLAN']
  }
, bluetooth: {
    name: 'Bluetooth'
  , ids: ['Bluetooth', 'com.apple.settings.bluetooth']
  , labels: ['Bluetooth']
  }
, general: {
    name: 'General'
  , ids: ['General', 'com.apple.settings.general']
  , labels: ['General']
  }
, storage: {
    name: 'iPhone Storage'
  , ids: ['STORAGE_MGMT', 'com.apple.settings.storage', 'com.apple.settings.general.storage']
  , labels: ['iPhone Storage', 'iPad Storage', 'iPod touch Storage']
  }
, developer: {
    name: 'Developer'
  , ids: ['DEVELOPER_SETTINGS', 'com.apple.settings.developer']
  , labels: ['Developer']
  , far: true
  }
}

var PAGES: Record<IosSettingsPage, ItemSpec[]> = {
  wifi: [ITEMS.wifi]
, bluetooth: [ITEMS.bluetooth]
, storage: [ITEMS.general, ITEMS.storage]
, developer: [ITEMS.developer]
}

// How many times a page is scrolled for an item low on it
var MAX_SWIPES = 8

export function isSettingsPage(page: string): page is IosSettingsPage {
  return Object.prototype.hasOwnProperty.call(PAGES, page)
}

function quote(value: string): string {
  return '\'' + value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'') + '\''
}

function predicateList(values: string[]): string {
  return '{' + values.map(quote).join(', ') + '}'
}

function itemPredicate(spec: ItemSpec): string {
  var labels = spec.labels.map(function(label) {
    return 'label == ' + quote(label) + ' OR label BEGINSWITH ' + quote(label + ', ')
  })
  return '(type == \'XCUIElementTypeCell\' OR type == \'XCUIElementTypeButton\') AND (name IN ' +
    predicateList(spec.ids) + ' OR ' + labels.join(' OR ') + ')'
}

export function cellPredicate(radio: IosRadio): string {
  return itemPredicate(ITEMS[radio])
}

// switchPredicate <radio> <itemLabel>: the switch of the page of the radio, also by the label of
// its item without the value
export function switchPredicate(radio: IosRadio, itemLabel: string | null): string {
  var spec = ITEMS[radio]
  var labels = spec.labels.slice()
  var own = itemLabel ? itemLabel.split(', ')[0]! : ''
  if (own && !labels.includes(own)) {
    labels.push(own)
  }
  return 'type == \'XCUIElementTypeSwitch\' AND (name IN ' + predicateList(spec.ids) +
    ' OR label IN ' + predicateList(labels) + ')'
}

var SCROLL_VIEW = 'type == \'XCUIElementTypeCollectionView\' OR type == \'XCUIElementTypeTable\''

function isOn(value: unknown): boolean {
  return value === '1' || value === 1 || value === true || value === 'true'
}

// Turns Wi-Fi and Bluetooth on and off and opens pages of Settings the way a user does: opens
// Settings through WDA and taps its items; iOS has no API for it without MDM. A switch is read or
// tapped, then the app that was in front comes back
export default class SettingsAutomation extends WdaAutomation {
  constructor(options: WdaAutomationOptions) {
    super(options)
  }

  // isEnabled <radio>: whether the switch of the radio is on
  isEnabled(radio: IosRadio): Promise<boolean> {
    return this.serial(() => this.onSwitch(radio, (predicate) => this.switchState(predicate)))
  }

  // setEnabled <radio> <enabled>: turns the switch of the radio on or off, resolves with its state
  setEnabled(radio: IosRadio, enabled: boolean): Promise<boolean> {
    return this.serial(() => this.onSwitch(radio, (predicate) => this.turn(predicate, enabled)))
  }

  // openPage <page>: opens a page of Settings and leaves it in front
  openPage(page: IosSettingsPage): Promise<unknown> {
    return this.serial(() => {
      return this.unlock()
        .then(() => this.openSettings())
        .then(() => Promise.each(PAGES[page], (spec) => this.findItem(spec)
          .then((item) => this.click(item))))
    })
  }

  private switchState(predicate: string): Promise<boolean> {
    return this.waitFor(() => this.findFirst(predicate).then((element) => {
      return element ? this.attribute(element, 'value').then(isOn) : null
    }), 'The switch cannot be read')
  }

  // The switch is found again for every step: its page may still be moving when it is first found
  private turn(predicate: string, enabled: boolean): Promise<boolean> {
    return this.switchState(predicate).then((current) => {
      if (current === enabled) {
        return current
      }
      return this.waitFor(() => this.findFirst(predicate).then((element) => {
        return element ? this.click(element).then(() => true) : null
      }), 'The switch cannot be tapped')
        .then(() => this.waitFor(
          () => this.switchState(predicate).then(function(value) {
            return value === enabled ? value : null
          })
        , 'The switch did not turn ' + (enabled ? 'on' : 'off')
        ))
    })
  }

  private onSwitch<T>(radio: IosRadio, action: (predicate: string) => Promise<T>): Promise<T> {
    var previous: string | null = null

    return this.activeApp()
      .then((bundleId) => {
        previous = bundleId
        return this.unlock()
      })
      .then(() => this.openSettings())
      .then(() => this.findItem(ITEMS[radio]))
      .then((item) => this.attribute(item, 'label')
        .then((label) => this.click(item).then(() => label)))
      .then((label) => {
        var predicate = switchPredicate(radio, typeof label === 'string' ? label : null)
        return this.waitFor(
          () => this.findFirst(predicate)
        , 'The page of ' + ITEMS[radio].name + ' has no switch'
        ).then(() => action(predicate))
      })
      .finally(() => this.restore(previous, SETTINGS_BUNDLE_ID))
  }

  // Settings opens on its last page, so it is started again to open on the root page
  private openSettings(): Promise<unknown> {
    var body = {bundleId: SETTINGS_BUNDLE_ID}
    return this.post('/wda/apps/terminate', body)
      .catch(function() {
        return null
      })
      .then(() => this.post('/wda/apps/launch', body))
  }

  // findItem <spec>: the item on the page in front; an item low on its page is looked for while the
  // page is scrolled, once the page shows its list
  private findItem(spec: ItemSpec): Promise<string> {
    var missing = 'Settings has no ' + spec.name + ' item'
    var find = () => this.findFirst(itemPredicate(spec))
    if (!spec.far) {
      return this.waitFor(find, missing)
    }

    var swipes = 0
    var look = (): Promise<string> => {
      // the page stands still once a swipe is done, so it is looked at once
      return this.poll(find, swipes ? 0 : this.options.pollInterval * 2).then((result) => {
        if (result.found !== null) {
          return result.found
        }
        if (swipes++ >= MAX_SWIPES) {
          throw new Error(missing)
        }
        return this.findFirst(SCROLL_VIEW)
          .then((view) => {
            return view ? this.post('/wda/element/' + view + '/swipe', {direction: 'up'}) : null
          })
          .catch(function() {
            return null
          })
          .then(look)
      })
    }
    return this.waitFor(() => this.findFirst(SCROLL_VIEW), missing).then(look)
  }
}
