import Promise from 'bluebird'

import WdaAutomation, {type WdaAutomationOptions} from './automation.js'
import type {WdaValueResponse} from '../../../../types/ios-device.js'

var RUNNER_SUFFIX = '.xctrunner'

// The settings of WDA that make an app switch wait for the app to be idle (up to half a minute for
// the runner of WDA); they are turned off while the runner is in front, then restored
var IDLE_SETTINGS = ['waitForIdleTimeout', 'animationCoolOffTimeout']

interface WdaStatus {
  build?: {productBundleIdentifier?: string}
}

// runnerBundleId <status>: the bundle of the app that runs WDA, by the /status of WDA
export function runnerBundleId(status: WdaStatus | undefined): string {
  var id = status?.build?.productBundleIdentifier || 'com.facebook.WebDriverAgentRunner'
  return id.endsWith(RUNNER_SUFFIX) ? id : id + RUNNER_SUFFIX
}

// The clipboard of an iOS device. An app reads and writes the pasteboard only when it is in front
// (iOS 16+), so the runner of WDA is brought to the front for a moment, then the app that was in
// front comes back. WDA accepts the "Allow Paste" alert of iOS itself
export default class PasteboardAutomation extends WdaAutomation {
  private keyboardTimeout: number

  // keyboardTimeout: how long the keyboard of the app that comes back is waited for
  constructor(options: WdaAutomationOptions & {keyboardTimeout?: number}) {
    super(options)
    this.keyboardTimeout = options.keyboardTimeout || 3000
  }

  // get: the text in the pasteboard, '' when there is none
  get(): Promise<string> {
    return this.serial(() => this.inRunner(() => {
      return this.post<WdaValueResponse<string>>('/wda/getPasteboard', {contentType: 'plaintext'})
        .then(function(response) {
          return Buffer.from(response.value || '', 'base64').toString('utf8')
        })
    }))
  }

  // paste <text>: puts the text in the pasteboard and types it into the focused field like the
  // paste of Android; without a focused field the text is only in the pasteboard
  paste(text: string): Promise<boolean> {
    return this.serial(() => {
      return this.inRunner(() => this.post('/wda/setPasteboard', {
        content: Buffer.from(text, 'utf8').toString('base64')
      , contentType: 'plaintext'
      }))
        // the keyboard of the app that came back shows up again after a moment
        .then(() => this.hasKeyboard(this.keyboardTimeout))
        .then((focused) => {
          if (!focused) {
            return false
          }
          return this.post('/wda/keys', {value: [text]})
            .then(function() {
              return true
            })
            .catch(function() {
              return false
            })
        })
    })
  }

  private inRunner<T>(action: () => Promise<T>): Promise<T> {
    var previous: string | null = null
    var saved: Record<string, unknown> | null = null

    return this.activeApp()
      .then((bundleId) => {
        previous = bundleId
        return this.settings()
      })
      .then((settings) => {
        saved = settings
        return this.setSettings(Object.fromEntries(IDLE_SETTINGS.map(function(name) {
          return [name, 0]
        })))
      })
      .then(() => this.send<WdaValueResponse<WdaStatus>>({
        method: 'GET'
      , uri: this.options.baseUrl + '/status'
      }))
      .then((status) => this.post('/wda/apps/activate', {bundleId: runnerBundleId(status.value)}))
      .then(action)
      // The settings first: the app that comes back is waited for, so typing goes to it
      .finally(() => {
        return Promise.resolve(saved ? this.setSettings(saved) : null)
          .then(() => this.restore(previous))
          .catch(function() {
            return null
          })
      })
  }

  private settings(): Promise<Record<string, unknown> | null> {
    return Promise.try(() => this.send<WdaValueResponse<Record<string, unknown>>>({
      method: 'GET'
    , uri: this.session('/appium/settings')
    }))
      .then(function(response) {
        var saved: Record<string, unknown> = {}
        IDLE_SETTINGS.forEach(function(name) {
          if (response.value && name in response.value) {
            saved[name] = response.value[name]
          }
        })
        return Object.keys(saved).length ? saved : null
      })
      .catch(function() {
        return null
      })
  }

  private setSettings(settings: Record<string, unknown>): Promise<unknown> {
    return this.post('/appium/settings', {settings: settings}).catch(function() {
      return null
    })
  }
}
