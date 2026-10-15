// Fork (Zebrunner): the socket events the device control sends for iOS devices
import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {Device} from './devices/types'

const emitted: unknown[][] = []

vi.mock('./socket', () => ({
  emit: (...args: unknown[]) => {
    emitted.push(args)
  }
}))

vi.mock('./transaction', () => ({
  createTransaction: () => ({channel: 'tx', promise: Promise.resolve()})
}))

const {createControl} = await import('./control')

function events() {
  return emitted.map((args) => args[0])
}

describe('createControl (Zebrunner)', () => {
  const ios = createControl({serial: 'udid', ios: true} as Device, 'channel')
  const android = createControl({serial: 'serial'} as Device, 'channel')

  beforeEach(() => {
    emitted.length = 0
  })

  it('sends the touches of an iOS device as their own events', () => {
    ios.touchDownIos(1, 0, 0.25, 0.5, 0.5)
    ios.touchMoveIos(0.75, 0.5, 0.25, 0.5)
    expect(emitted).toEqual([
      ['input.touchDownIos', 'channel', {seq: 1, contact: 0, x: 0.25, y: 0.5, pressure: 0.5}]
      , ['input.touchMoveIos', 'channel', {
        seq: 0
        , contact: 0
        , toX: 0.75
        , toY: 0.5
        , fromX: 0.25
        , fromY: 0.5
        , pressure: undefined
      }]
    ])
  })

  it('sends the other actions of an iOS device as the upstream events', () => {
    ios.copy()
    ios.reboot()
    ios.openStore()
    ios.screenshot()
    ios.openBrowser('https://example.com')
    ios.install({href: '/s/apk/id/app.ipa', manifest: {}, launch: true})
    ios.startLogcat([])
    ios.stopLogcat()
    expect(events()).toEqual([
      'clipboard.copy'
      , 'device.reboot'
      , 'store.open'
      , 'screen.capture'
      , 'browser.open'
      , 'device.install'
      , 'logcat.start'
      , 'logcat.stop'
    ])
  })

  it('sends the same events for an Android device', () => {
    android.copy()
    android.reboot()
    android.startLogcat([])
    expect(events()).toEqual(['clipboard.copy', 'device.reboot', 'logcat.start'])
  })

  it('opens the settings of an iOS device', () => {
    ios.openSettings()
    expect(emitted).toEqual([['settings.open', 'channel', undefined]])
  })
})
