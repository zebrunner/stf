// Fork (Zebrunner): the iOS and status methods of lib/db/api.ts
import {expect} from 'chai'

import type DbApi from '../../../lib/db/api.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

type InitialState = Parameters<typeof DbApi.initializeIosDeviceState>[1]
type IosDeviceInfoMessageFields = Parameters<typeof DbApi.setIosDeviceInfo>[0]

// The documents the methods write, as test/db/api.mts reads them: a built update term is
// [UPDATE, [[target], {document}]], an insert one is [INSERT, [[table], {document}]]
var writes: any[] = []
var updateResult: object = {skipped: 0}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {
  run: function(query: {build(): any}) {
    var term = query.build()
    if (Array.isArray(term) && term.length > 1 && Array.isArray(term[1]) && term[1][1]) {
      writes.push(term[1][1])
      return Promise.resolve(updateResult)
    }
    return Promise.resolve(null)
  }
}})

var dbapi: typeof DbApi =
  (await importFresh(new URL('../../../lib/db/api.js', import.meta.url))).default
restoreDb()

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[name]
  }
  else {
    process.env[name] = value
  }
}

describe('zebrunner: dbapi', function() {
  beforeEach(function() {
    writes = []
    updateResult = {skipped: 0}
  })

  it('should override the status without a timestamp of the device units', async function() {
    await dbapi.setDeviceStatusOverride('serial', 7)
    expect(writes[0].status).to.equal(7)
    expect(writes[0]).to.have.property('statusChangedAt')
    expect(writes[0]).to.not.have.property('statusTimeStamp')
  })

  it('should mark and unmark a device as being used', async function() {
    await dbapi.markDeviceAsUsing('serial')
    await dbapi.unmarkDeviceAsUsing('serial')
    expect(writes).to.eql([{using: true}, {using: false}])
  })

  it('should keep the size and the type of an iOS device', async function() {
    await dbapi.sizeIosDevice('serial', 2532, 1170, 3)
    await dbapi.setDeviceType('serial', 'tvOS')
    expect(writes[0]).to.eql({display: {height: 2532, width: 1170, scale: 3}})
    expect(writes[1]).to.eql({deviceType: 'tvOS'})
  })

  it('should keep the battery of an iOS device', async function() {
    await dbapi.setDeviceIosBattery({
      id: 'serial'
    , health: 'good'
    , source: 'usb'
    , status: 'charging'
    , level: 80
    , temp: '30.5'
    , scale: 100
    , voltage: 4.184
    })
    expect(writes[0].battery).to.eql({
      health: 'good'
    , source: 'usb'
    , status: 'charging'
    , level: 80
    , temp: 30.5
    , scale: 100
    , voltage: 4.184
    })
  })

  // WDA knows the level and the state only, go-ios the rest
  it('should keep the battery fields an iOS device does not tell', async function() {
    await dbapi.setDeviceIosBattery({
      id: 'serial'
    , health: ''
    , source: 'usb'
    , status: 'full'
    , level: 100
    , temp: 'n/a'
    , scale: 100
    , voltage: null as unknown as number
    })
    expect(writes[0].battery).to.eql({source: 'usb', status: 'full', level: 100, scale: 100})
  })

  it('should keep what lockdown tells of an iOS device', async function() {
    await dbapi.setIosDeviceInfo({
      serial: 'serial'
    , manufacturer: 'Apple'
    , product: 'iPhone11,8'
    , version: '18.7.10'
    , sdk: '22H374'
    , abi: 'arm64e'
    , cpuPlatform: 't8020'
    , operator: null as unknown as string
    , phone: {imei: '357366097804847', imsi: null, phoneNumber: '', iccid: null, network: null} as
        unknown as IosDeviceInfoMessageFields['phone']
    , rom: 60982
    })
    expect(writes[0]).to.eql({
      manufacturer: 'Apple'
    , product: 'iPhone11,8'
    , version: '18.7.10'
    , sdk: '22H374'
    , abi: 'arm64e'
    , cpuPlatform: 't8020'
    , phone: {imei: '357366097804847'}
    , memory: {rom: 60982}
    })
  })

  it('should make a ready device present', async function() {
    await dbapi.setDeviceReady('serial', 'channel')
    expect(writes[0].ready).to.equal(true)
    expect(writes[0].present).to.equal(true)
  })

  describe('initializeIosDeviceState', function() {
    function state(screenWsUrlPattern = ''): InitialState {
      return {
        serial: 'udid'
      , status: 3
      , provider: {channel: 'channel', name: 'provider', screenWsUrlPattern: screenWsUrlPattern}
      , ports: {screenPort: 7404, connectPort: 7405}
      , options: {id: 'udid', name: 'iPhone 15', platform: 'iOS', architect: 'arm64'}
      } as unknown as InitialState
    }
    var message = state()

    it('should make the device present and ready as an iOS device', async function() {
      await dbapi.initializeIosDeviceState('stf.example.com', message)
      var device = writes[0]
      expect(device.present).to.equal(true)
      expect(device.ready).to.equal(true)
      expect(device.ios).to.equal(true)
      expect(device.owner).to.equal(null)
      expect(device.statusTimeStamp).to.equal(0)
      expect(device.model).to.equal('iPhone 15')
      expect(device.platform).to.equal('iOS')
      expect(device.screenPort).to.equal(7404)
      expect(device.connectPort).to.equal(7405)
    })

    it('should build the screen URL from the public address without a pattern', async function() {
      await dbapi.initializeIosDeviceState('stf.example.com', message)
      expect(writes[0].display.url).to.equal('ws://stf.example.com:7404/')
    })

    it('should give a known device to the administrator', async function() {
      var saved = [process.env.STF_ADMIN_EMAIL, process.env.STF_ADMIN_NAME]
      process.env.STF_ADMIN_EMAIL = 'admin@zebrunner.com'
      process.env.STF_ADMIN_NAME = 'admin'
      try {
        await dbapi.initializeIosDeviceState('stf.example.com', message)
        expect(writes[1]).to.eql({group: {owner: {email: 'admin@zebrunner.com', name: 'admin'}}})
      }
      finally {
        restoreEnv('STF_ADMIN_EMAIL', saved[0])
        restoreEnv('STF_ADMIN_NAME', saved[1])
      }
    })

    it('should give a known device to the default administrator without the variables',
      async function() {
        var saved = [process.env.STF_ADMIN_EMAIL, process.env.STF_ADMIN_NAME]
        delete process.env.STF_ADMIN_EMAIL
        delete process.env.STF_ADMIN_NAME
        try {
          await dbapi.initializeIosDeviceState('stf.example.com', message)
          expect(writes[1]).to.eql({
            group: {owner: {email: 'administrator@fakedomain.com', name: 'administrator'}}
          })
        }
        finally {
          restoreEnv('STF_ADMIN_EMAIL', saved[0])
          restoreEnv('STF_ADMIN_NAME', saved[1])
        }
      })

    it('should keep the screen URL pattern of the provider', async function() {
      await dbapi.initializeIosDeviceState(
        'stf.example.com'
      , state('wss://stf.example.com/d/host/udid/7404/')
      )
      expect(writes[0].display.url).to.equal('wss://stf.example.com/d/host/udid/7404/')
    })
  })
})
