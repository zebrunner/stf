// Fork (Zebrunner): the device routes the fork adds to the REST API,
// lib/units/api/controllers/zebrunner.ts and the status of lib/units/api/helpers/device-status.ts
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

import {expect} from 'chai'
import sinon from 'sinon'

import {importFresh, mockModule} from '../../helpers/module-mock.mts'

interface Reply {
  code: number
  body: any
}

var dbapi = {
  loadDevice: sinon.stub()
, loadDeviceBySerial: sinon.stub()
, setDeviceNote: sinon.stub()
, setDeviceAbsent: sinon.stub()
, setDeviceStatusOverride: sinon.stub()
, unsetDeviceOwner: sinon.stub()
, setDeviceOwner: sinon.stub()
, markDeviceAsUsing: sinon.stub()
, unmarkDeviceAsUsing: sinon.stub()
, getDeviceSize: sinon.stub()
, getDeviceGroupOwner: sinon.stub()
, getDeviceType: sinon.stub()
}

// The real module connects to RethinkDB as it loads
var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: dbapi})
var devices = await importFresh(
  new URL('../../../lib/units/api/controllers/devices.js', import.meta.url)
)
var zebrunner = await importFresh(
  new URL('../../../lib/units/api/controllers/zebrunner.js', import.meta.url)
)
restoreDbApi()
restoreDb()

function request(params: Record<string, unknown>, user?: object) {
  var swagger: Record<string, {value: unknown}> = {}
  Object.keys(params).forEach(function(name) {
    swagger[name] = {value: params[name]}
  })
  return {swagger: {params: swagger}, user: user}
}

// call <route> <params> [user]: the status code and the JSON body the route answers with
function call(route: string, params: Record<string, unknown>, user?: object): Promise<Reply> {
  return new Promise<Reply>(function(resolve) {
    var reply = {code: 200, body: null as unknown}
    var res = {
      status: function(code: number) {
        reply.code = code
        return res
      }
    , json: function(body: unknown) {
        reply.body = body
        resolve(reply)
        return res
      }
    }
    var controller = route in zebrunner ? zebrunner : devices
    controller[route](request(params, user), res)
  })
}

function putStatus(status: unknown, extra: object = {}) {
  return call('putDeviceBySerial', {serial: 'serial', device: {status: status, ...extra}})
}

// js-yaml comes with the swagger middleware of the API unit
var yaml = createRequire(import.meta.url)('js-yaml') as {load(text: string): unknown}

describe('zebrunner: device API', function() {
  it('should route the paths of the zebrunner controller to its functions', async function() {
    var swagger = yaml.load(await readFile(
      new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
    , 'utf8'
    )) as {paths: Record<string, Record<string, {operationId?: string}>>}
    var routed = Object.values(swagger.paths).filter(function(path) {
      return (path['x-swagger-router-controller'] as unknown) === 'zebrunner'
    }).flatMap(function(path) {
      return Object.values(path).map(function(operation) {
        return operation.operationId
      }).filter(Boolean)
    })
    expect(routed).to.have.members(['getDeviceSize', 'getDeviceOwner', 'getDeviceType'])
    routed.forEach(function(operationId) {
      expect(zebrunner[operationId!], operationId).to.be.a('function')
    })
  })

  beforeEach(function() {
    Object.values(dbapi).forEach(function(stub) {
      stub.reset()
      stub.resolves(true)
    })
    dbapi.loadDeviceBySerial.resolves({serial: 'serial'})
  })

  describe('PUT /devices/{serial} status', function() {
    var overrides: Array<[string, number]> = [
      ['offline', 1]
    , ['unauthorized', 5]
    , ['preparing', 6]
    , ['unhealthy', 7]
    ]

    overrides.forEach(function([status, code]) {
      it('should set the ' + status + ' status', async function() {
        var reply = await putStatus(status)
        expect(reply.code).to.equal(200)
        expect(dbapi.setDeviceStatusOverride.calledOnceWith('serial', code)).to.equal(true)
      })
    })

    it('should make a device absent, whatever the case of the status', async function() {
      var reply = await putStatus(' Disconnected ')
      expect(reply.code).to.equal(200)
      expect(dbapi.setDeviceAbsent.calledOnceWith('serial')).to.equal(true)
      expect(dbapi.setDeviceStatusOverride.called).to.equal(false)
    })

    it('should free a device that becomes available', async function() {
      var reply = await putStatus('available')
      expect(reply.code).to.equal(200)
      expect(dbapi.setDeviceStatusOverride.calledOnceWith('serial', 3)).to.equal(true)
      expect(dbapi.unsetDeviceOwner.calledOnceWith('serial')).to.equal(true)
      expect(dbapi.unmarkDeviceAsUsing.calledOnceWith('serial')).to.equal(true)
    })

    it('should give a busy device to its owner', async function() {
      var reply = await putStatus('busy', {owner: {name: 'Jane', email: 'jane@example.com'}})
      expect(reply.code).to.equal(200)
      expect(dbapi.setDeviceStatusOverride.calledOnceWith('serial', 3)).to.equal(true)
      expect(dbapi.setDeviceOwner.firstCall.args).to.eql([
        'serial'
      , {name: 'Jane', email: 'jane@example.com', group: ''}
      ])
      expect(dbapi.markDeviceAsUsing.calledOnceWith('serial')).to.equal(true)
    })

    it('should refuse a busy device without an owner', async function() {
      for (var extra of [{}, {owner: {}}, {owner: {name: '  '}}]) {
        var reply = await putStatus('busy', extra)
        expect(reply.code, JSON.stringify(extra)).to.equal(400)
        expect(reply.body.description).to.equal('Missing owner.name for busy status')
      }
      expect(dbapi.setDeviceOwner.called).to.equal(false)
    })

    it('should refuse an unknown status', async function() {
      var reply = await putStatus('broken')
      expect(reply.code).to.equal(400)
      expect(reply.body.description).to.equal('Unknown status requested')
    })

    it('should keep updating the note as upstream does', async function() {
      var reply = await call('putDeviceBySerial', {serial: 'serial', device: {note: 'n'}})
      expect(reply.code).to.equal(200)
      expect(dbapi.setDeviceNote.calledOnceWith('serial', 'n')).to.equal(true)
    })

    it('should answer 404 for an unknown device', async function() {
      dbapi.loadDeviceBySerial.resolves(null)
      expect((await putStatus('offline')).code).to.equal(404)
    })
  })

  // Fork (Zebrunner): lib/util/datautil.ts, the host of the device went away during a session and
  // the device stays controlled; the API answered `owner: null` with `using: true` to an admin
  describe('GET /devices/{serial} of an absent device with an owner', function() {
    var owner = {email: 'owner@example.com', name: 'Owner', group: 'group1'}
    var admin = {email: 'admin@example.com', privilege: 'admin', groups: {subscribed: []}}
    var other = {email: 'other@example.com', privilege: 'user', groups: {subscribed: []}}

    beforeEach(function() {
      dbapi.loadDevice.callsFake(function() {
        return Promise.resolve({
          next: function(callback: (err: Error | null, device: object) => void) {
            callback(null, {
              serial: 'serial'
            , present: false
            , ready: false
            , owner: {...owner}
            , group: {id: 'group1', origin: 'group1'}
            })
          }
        })
      })
    })

    it('should answer the owner to an admin, as it answers using', async function() {
      var reply = await call('getDeviceBySerial', {serial: 'serial', fields: null}, admin)
      expect(reply.body.device).to.include({present: false, using: true})
      expect(reply.body.device.owner).to.eql(owner)

      var fields = 'serial,owner,using'
      reply = await call('getDeviceBySerial', {serial: 'serial', fields: fields}, admin)
      expect(reply.body.device).to.eql({serial: 'serial', owner: owner, using: true})
    })

    it('should answer the owner to the owner', async function() {
      var reply = await call('getDeviceBySerial', {serial: 'serial', fields: null}, {
        ...other
      , email: owner.email
      })
      expect(reply.body.device.owner).to.eql(owner)
    })

    it('should not answer the owner to another user', async function() {
      var reply = await call('getDeviceBySerial', {serial: 'serial', fields: null}, other)
      expect(reply.body.device).to.include({owner: null, using: false})
    })
  })

  describe('GET /devices/{serial}/size', function() {
    it('should answer the display of the device', async function() {
      dbapi.getDeviceSize.resolves({height: 2532, width: 1170, scale: 3})
      var reply = await call('getDeviceSize', {serial: 'serial'})
      expect(reply.body).to.eql({height: 2532, width: 1170, scale: 3})
    })

    it('should answer an empty size for an unknown device or an error', async function() {
      dbapi.getDeviceSize.resolves(null)
      expect((await call('getDeviceSize', {serial: 'serial'})).body)
        .to.eql({height: 0, width: 0, scale: 0})
      dbapi.getDeviceSize.rejects(new Error('db'))
      expect((await call('getDeviceSize', {serial: 'serial'})).body)
        .to.eql({height: 0, width: 0, scale: 0})
    })
  })

  describe('GET /devices/{serial}/owner', function() {
    it('should answer the owner of the group of the device', async function() {
      dbapi.getDeviceGroupOwner.resolves({email: 'admin@example.com', name: 'admin'})
      var reply = await call('getDeviceOwner', {serial: 'serial'})
      expect(reply.code).to.equal(200)
      expect(reply.body).to.eql({email: 'admin@example.com', name: 'admin'})
    })

    it('should answer 404 for an unknown device and 500 for an error', async function() {
      dbapi.getDeviceGroupOwner.resolves(null)
      expect((await call('getDeviceOwner', {serial: 'serial'})).code).to.equal(404)
      dbapi.getDeviceGroupOwner.rejects(new Error('db'))
      expect((await call('getDeviceOwner', {serial: 'serial'})).code).to.equal(500)
    })
  })

  describe('GET /devices/{serial}/type', function() {
    it('should answer the type of the device', async function() {
      dbapi.getDeviceType.resolves('tvOS')
      expect((await call('getDeviceType', {serial: 'serial'})).body).to.equal('tvOS')
    })

    it('should answer no type for an error', async function() {
      dbapi.getDeviceType.rejects(new Error('db'))
      expect((await call('getDeviceType', {serial: 'serial'})).body).to.eql({deviceType: null})
    })
  })
})
