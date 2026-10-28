// Fork (Zebrunner): the type, the screen and the version of an iOS device from WebDriverAgent,
// lib/units/ios-device/plugins/devicestate.ts: the device units have no database, the processor
// stores them
import {expect} from 'chai'
import express from 'express'
import syrup from '@devicefarmer/stf-syrup'

import wire from '../../../lib/wire/index.js'
import {deviceTypeOf, screenOf} from '../../../lib/units/ios-device/plugins/devicestate.js'
import type {IosDeviceStatePlugin} from '../../../lib/units/ios-device/plugins/devicestate.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'
import {listen, type Running} from '../../helpers/zebrunner.mts'

interface FakeWda {
  model: string
  orientation: 'PORTRAIT' | 'LANDSCAPE'
  failures: number
  calls: string[]
}

function fakeWda(state: FakeWda) {
  var app = express()
  app.use(function(req, res, next) {
    state.calls.push(req.method + ' ' + req.path)
    if (state.failures > 0) {
      state.failures--
      res.status(500).json({value: {error: 'unknown error', message: 'not ready'}})
      return
    }
    next()
  })
  app.get('/wda/device/info', function(req, res) {
    res.json({value: {model: state.model, name: 'My ' + state.model}})
  })
  app.get('/window/size', function(req, res) {
    var portrait = state.orientation === 'PORTRAIT'
    res.json({value: portrait ? {width: 390, height: 844} : {width: 844, height: 390}})
  })
  app.get('/wda/screen', function(req, res) {
    res.json({value: {scale: 3, statusBarSize: {width: 390, height: 47}}})
  })
  app.get('/status', function(req, res) {
    res.json({value: {ready: true, device: 'iphone', os: {name: 'iOS', version: '17.4'}}})
  })
  return app
}

function delay(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

function decode(message: unknown[]) {
  var envelope = wire.Envelope.decode(message[1] as Buffer)
  var type = wire.ReverseMessageType[envelope.type]!
  var decoder = wire[type] as unknown as {decode(body: unknown): Record<string, unknown>}
  return {type: type, message: decoder.decode(envelope.message)}
}

describe('zebrunner: ios-device state', function() {
  var wda: Running, state: FakeWda, pushed: unknown[][]
  var lib = new URL('../../../lib/units/ios-device/', import.meta.url)

  async function load(): Promise<IosDeviceStatePlugin> {
    var restore = mockModule(new URL('support/push.js', lib), {
      default: syrup.serial().define(function() {
        return {
          send: function(message: unknown[]) {
            pushed.push(message)
          }
        }
      })
    })
    try {
      var plugin = (await importFresh(new URL('plugins/devicestate.js', lib))).default
      return await plugin.consume({
        serial: 'udid'
      , wdaHost: '127.0.0.1'
      , wdaPort: Number(new URL(wda.origin).port)
      }) as IosDeviceStatePlugin
    }
    finally {
      restore()
    }
  }

  function sent() {
    return pushed.map(decode).map(function(decoded) {
      return {type: decoded.type, message: Object.assign({}, decoded.message)}
    })
  }

  beforeEach(async function() {
    state = {model: 'iPhone', orientation: 'PORTRAIT', failures: 0, calls: []}
    pushed = []
    wda = await listen(fakeWda(state))
  })

  afterEach(function() {
    return wda.close()
  })

  it('should tell the type of the device by its model or name', function() {
    expect(deviceTypeOf({model: 'iPhone', name: 'My iPhone'})).to.equal('iPhone')
    expect(deviceTypeOf({model: 'iPad', name: 'iPad'})).to.equal('iPhone')
    expect(deviceTypeOf({model: 'AppleTV', name: 'Living room'})).to.equal('Apple TV')
    expect(deviceTypeOf({model: 'Apple', name: 'Apple TV 4K'})).to.equal('Apple TV')
  })

  it('should keep the screen of a phone portrait and the one of a TV as it is', function() {
    expect(screenOf('iPhone', {width: 844, height: 390}, {scale: 3}))
      .to.eql({width: 1170, height: 2532, scale: 3})
    expect(screenOf('Apple TV', {width: 1920, height: 1080}, {scale: 1}))
      .to.eql({width: 1920, height: 1080, scale: 1})
    expect(function() {
      screenOf('iPhone', {width: 0, height: 390}, {scale: 3})
    }).to.throw(/Invalid screen/)
  })

  it('should read the device without a WDA session and report it at start', async function() {
    state.orientation = 'LANDSCAPE'
    var devicestate = await load()
    await delay(200)

    expect(await devicestate.type()).to.equal('iPhone')
    expect(await devicestate.screen()).to.eql({width: 1170, height: 2532, scale: 3})
    expect(sent()).to.eql([
      {
        type: 'IosDeviceScreenMessage'
      , message: {serial: 'udid', deviceType: 'iPhone', width: 1170, height: 2532, scale: 3}
      }
    , {type: 'SdkIosVersion', message: {id: 'udid', device: 'iphone', sdkVersion: '17.4'}}
    ])
    expect(state.calls.filter(function(call) {
      return /session/.test(call)
    })).to.eql([])
  })

  it('should read WDA once and report again on demand', async function() {
    var devicestate = await load()
    await delay(200)
    var calls = state.calls.length

    await devicestate.report()
    expect(state.calls.length).to.equal(calls)
    var screen = 'IosDeviceScreenMessage'
    var version = 'SdkIosVersion'
    expect(sent().map(function(message) {
      return message.type
    })).to.eql([screen, version, screen, version])
  })

  it('should read WDA again when it failed at start', async function() {
    state.failures = 100
    var devicestate = await load()
    await delay(200)
    expect(sent()).to.eql([])

    state.failures = 0
    await devicestate.report()
    expect(sent().map(function(message) {
      return message.type
    })).to.eql(['IosDeviceScreenMessage', 'SdkIosVersion'])
  })

  it('should report an Apple TV', async function() {
    state.model = 'AppleTV'
    state.orientation = 'LANDSCAPE'
    var devicestate = await load()
    await delay(200)

    expect(await devicestate.type()).to.equal('Apple TV')
    expect(sent()[0]!.message).to.include({deviceType: 'Apple TV', width: 2532, height: 1170})
  })
})
