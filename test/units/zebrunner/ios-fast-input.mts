// Fork (Zebrunner): the settings of WDA for the UI of STF in the sessions STF creates
// (lib/units/ios-device/plugins/wda/fast-input.ts)
import {expect} from 'chai'
import express from 'express'

import {
  DEFAULT_SETTINGS
, FAST_SETTINGS
, isFastInput
, startFastInput
, stopFastInput
, withFullSnapshots
} from '../../../lib/units/ios-device/plugins/wda/fast-input.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

describe('zebrunner: iOS fast input settings', function() {
  var server: Running
    , settings: Record<string, number>
    , posted: Array<Record<string, number>>
    , status: number

  beforeEach(async function() {
    settings = {...DEFAULT_SETTINGS, mjpegServerFramerate: 6}
    posted = []
    status = 200
    var app = express()
    app.use(express.json())
    app.get('/session/:id/appium/settings', function(req, res) {
      res.json({value: settings})
    })
    app.post('/session/:id/appium/settings', function(req, res) {
      if (status !== 200) {
        res.status(status).json({value: {error: 'unknown error', message: 'bad'}})
        return
      }
      posted.push(req.body.settings)
      Object.assign(settings, req.body.settings)
      res.json({value: settings})
    })
    server = await listen(app)
  })

  afterEach(async function() {
    await stopFastInput()
    await server.close()
  })

  it('should speed up a session STF created, restore the defaults at its end', async function() {
    await startFastInput(server.origin, 's1', true)
    expect(isFastInput()).to.equal(true)
    expect(settings).to.include(FAST_SETTINGS)
    await stopFastInput()
    expect(isFastInput()).to.equal(false)
    expect(settings).to.include(DEFAULT_SETTINGS)
    expect(posted).to.deep.equal([FAST_SETTINGS, DEFAULT_SETTINGS])
  })

  it('should leave the settings of an Appium session alone', async function() {
    await startFastInput(server.origin, 's1', false)
    expect(isFastInput()).to.equal(false)
    await stopFastInput()
    await withFullSnapshots(() => 1)
    expect(posted).to.deep.equal([])
  })

  it('should take back the fast settings a session of STF left', async function() {
    Object.assign(settings, FAST_SETTINGS)
    await startFastInput(server.origin, 's1', false)
    expect(isFastInput()).to.equal(true)
    await stopFastInput()
    expect(settings).to.include(DEFAULT_SETTINGS)
  })

  it('should look for elements with the default settings', async function() {
    await startFastInput(server.origin, 's1', true)
    var during: Record<string, number> = {}
    var result = await withFullSnapshots(function() {
      during = {...settings}
      return 'found'
    })
    expect(result).to.equal('found')
    expect(during).to.include(DEFAULT_SETTINGS)
    expect(settings).to.include(FAST_SETTINGS)
  })

  it('should bring the fast settings back after a failed lookup', async function() {
    await startFastInput(server.origin, 's1', true)
    var failed = await withFullSnapshots(function() {
      throw new Error('no such element')
    }).catch(function(err: Error) {
      return err.message
    })
    expect(failed).to.equal('no such element')
    expect(settings).to.include(FAST_SETTINGS)
  })

  it('should not bring the fast settings back once the session ended', async function() {
    await startFastInput(server.origin, 's1', true)
    await withFullSnapshots(function() {
      return stopFastInput()
    })
    expect(settings).to.include(DEFAULT_SETTINGS)
  })

  it('should survive an error of WDA', async function() {
    status = 500
    await startFastInput(server.origin, 's1', true)
    expect(isFastInput()).to.equal(false)
    expect(settings).to.include(DEFAULT_SETTINGS)
  })
})
