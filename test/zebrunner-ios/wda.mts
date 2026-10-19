// Fork (Zebrunner): the WDA client of the ios-device unit against WebDriverAgent on an iOS
// simulator. Run by .github/workflows/zebrunner-ios.yml for every iOS version, or locally:
//
//   WDA_PORT=8100 MJPEG_PORT=9100 IOS_VERSION=27 npx mocha --extension mts test/zebrunner-ios
//
// The STF side of the unit (database, ZeroMQ) is faked by test/helpers/ios-wda.mts.
import net from 'node:net'

import {expect} from 'chai'

import rp from '../../lib/units/ios-device/plugins/util/rp.js'
import SettingsAutomation from '../../lib/units/ios-device/plugins/wda/settings.js'
import {loadWdaClient, type IosWda} from '../helpers/ios-wda.mts'

var WDA_HOST = process.env.WDA_HOST || '127.0.0.1'
var WDA_PORT = Number(process.env.WDA_PORT || 8100)
var MJPEG_PORT = Number(process.env.MJPEG_PORT || 9100)
var IOS_VERSION = process.env.IOS_VERSION || ''
var BASE = `http://${WDA_HOST}:${WDA_PORT}`

interface Value<T> {
  value: T
  sessionId?: string
}

function wda<T>(method: string, path: string, body?: object): Promise<Value<T>> {
  return Promise.resolve(rp<Value<T>>(Object.assign(
    {method: method, uri: BASE + path, json: true}
  , body ? {body: body} : {}
  )))
}

function delay(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

// until <check> [timeout]: waits for the check to pass
async function until(check: () => Promise<boolean>, timeout = 20000) {
  var end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) {
      return
    }
    await delay(500)
  }
  throw new Error('timed out')
}

// failures <errors>: readable errors for the assertion messages
function failures(errors: unknown[]): string[] {
  return errors.map(function(err) {
    var body = err as {error?: {value?: {message?: string}}, message?: string}
    return body.error?.value?.message || body.message || String(err)
  })
}

async function activeBundle(): Promise<string> {
  return (await wda<{bundleId: string}>('GET', '/wda/activeAppInfo')).value.bundleId
}

async function noSession() {
  var status = await wda<unknown>('GET', '/status')
  if (status.sessionId) {
    await wda('DELETE', `/session/${status.sessionId}`)
  }
}

describe('zebrunner: iOS ' + (IOS_VERSION || '(any version)') + ' simulator', function() {
  this.timeout(120000)

  var ios: IosWda

  before(async function() {
    await until(async function() {
      try {
        return Boolean((await wda<{ready?: boolean}>('GET', '/status')).value)
      }
      catch {
        return false
      }
    }, 60000)
    await noSession()
    ios = await loadWdaClient({
      serial: 'simulator'
    , wdaHost: WDA_HOST
    , wdaPort: WDA_PORT
    , connectPort: MJPEG_PORT
    })
  })

  after(async function() {
    await noSession()
  })

  it('[check:session] should start a session and report the iOS version', async function() {
    await ios.client.startSession()
    expect(ios.client.ownSession).to.equal(true)
    var version = ios.sent().find(function(entry) {
      return entry.type === 'SdkIosVersion'
    })
    expect(version, 'SdkIosVersion').to.be.an('object')
    if (IOS_VERSION) {
      expect(String(version!.message.sdkVersion).split('.')[0]).to.equal(IOS_VERSION)
    }
    expect(ios.sent().some(function(entry) {
      return entry.type === 'DeviceStatusMessage' && entry.message.status === 3
    })).to.equal(true)
  })

  it('[check:appium] should keep the session of an Appium test and its app', async function() {
    await ios.client.stopSession()
    var appium = await wda<{capabilities: object}>('POST', '/session', {
      capabilities: {alwaysMatch: {bundleId: 'com.apple.Preferences'}}
    })
    await until(async function() {
      return await activeBundle() === 'com.apple.Preferences'
    })

    await ios.client.startSession()
    expect(ios.client.sessionId).to.equal(appium.sessionId)
    expect(ios.client.ownSession).to.equal(false)
    await ios.client.stopSession()

    var status = await wda<unknown>('GET', '/status')
    expect(status.sessionId).to.equal(appium.sessionId)
    expect(await activeBundle()).to.equal('com.apple.Preferences')
    await wda('DELETE', `/session/${appium.sessionId}`)
  })

  it('[check:size] should know the size of the screen in points', async function() {
    await ios.client.startSession()
    var sessionId = ios.client.sessionId
    var size = (await wda<{width: number, height: number}>(
      'GET', `/session/${sessionId}/window/size`
    )).value
    var scale = (await wda<{scale: number}>('GET', `/session/${sessionId}/wda/screen`)).value.scale
    // What the unit stores at the first join, see storeDeviceSize of plugins/group.ts
    ios.setDisplay({width: size.width * scale, height: size.height * scale, scale: scale})
    ios.client.deviceSize = null

    expect(await ios.client.size()).to.eql({width: size.width, height: size.height})
  })

  it('[check:device] should read the orientation and the battery', async function() {
    await ios.client.getOrientation()
    expect(ios.client.orientation).to.equal('PORTRAIT')
    await ios.client.batteryIosEvent()
    expect(ios.sent().some(function(entry) {
      return entry.type === 'BatteryIosEvent'
    })).to.equal(true)
  })

  it('[check:home] should go to the home screen', async function() {
    await wda('POST', `/session/${ios.client.sessionId}/wda/apps/launch`, {
      bundleId: 'com.apple.Preferences'
    })
    await ios.client.homeBtn()
    await until(async function() {
      return await activeBundle() === 'com.apple.springboard'
    })
  })

  it('[check:touch] should tap and swipe', async function() {
    ios.client.tap({x: 0.5, y: 0.5})
    await ios.client.touchUp()

    ios.client.swipe({fromX: 0.8, fromY: 0.5, toX: 0.2, toY: 0.5, duration: 0.3})
    await until(async function() {
      return !ios.client.isSwiping
    })
    expect(failures(ios.fatal)).to.eql([])
  })

  it('[check:screenshot] should take a screenshot', async function() {
    var screenshot = await ios.client.screenshot()
    expect(Buffer.from(screenshot.value, 'base64').subarray(1, 4).toString()).to.equal('PNG')
  })

  // A simulator has no Wi-Fi in Settings: the radio is either read, or missing (not a WDA error)
  it('[check:settings] should look for Wi-Fi in Settings and bring back the app', async function() {
    await ios.client.homeBtn()
    await until(async function() {
      return await activeBundle() === 'com.apple.springboard'
    })
    var settings = new SettingsAutomation({
      baseUrl: BASE
    , sessionId: function() {
        return ios.client.sessionId
      }
    , waitTimeout: 5000
    })
    try {
      expect(await settings.isEnabled('wifi')).to.be.a('boolean')
    }
    catch (err) {
      expect((err as Error).message).to.equal('Settings has no Wi-Fi item')
    }
    await until(async function() {
      return await activeBundle() === 'com.apple.springboard'
    })
    expect(failures(ios.fatal)).to.eql([])
  })

  it('[check:url] should open an address in Safari from iOS 17 on, like the UI', async function() {
    if (IOS_VERSION && Number(IOS_VERSION) < 17) {
      this.skip()
    }
    await ios.client.openUrl({url: 'https://example.com'} as Parameters<IosWda['client']['openUrl']>[0])
    await until(async function() {
      return await activeBundle() === 'com.apple.mobilesafari'
    })
  })

  it('[check:stream] should stream the screen as MJPEG', async function() {
    var frame = await new Promise<Buffer>(function(resolve, reject) {
      var data = Buffer.alloc(0)
      var socket = net.connect(MJPEG_PORT, WDA_HOST, function() {
        socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n')
      })
      var timer = setTimeout(function() {
        socket.destroy()
        reject(new Error('no JPEG frame'))
      }, 60000)
      socket.on('data', function(chunk) {
        data = Buffer.concat([data, chunk as Buffer])
        var start = data.indexOf(Buffer.from([0xff, 0xd8]))
        if (start !== -1 && data.indexOf(Buffer.from([0xff, 0xd9]), start) !== -1) {
          clearTimeout(timer)
          socket.destroy()
          resolve(data.subarray(start))
        }
      })
      socket.on('error', reject)
    })
    expect(frame[0]).to.equal(0xff)
    expect(frame[1]).to.equal(0xd8)
  })

  it('[check:stable] should not have stopped the unit or reported the device absent', function() {
    expect(failures(ios.fatal)).to.eql([])
    expect(failures(ios.absent)).to.eql([])
  })
})
