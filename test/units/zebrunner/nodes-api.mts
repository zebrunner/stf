// Fork (Zebrunner): the routes of the enrolled nodes, lib/units/api/controllers/zebrunner-nodes.ts,
// with the database stubbed (test/units/zebrunner/nodes-rethinkdb.mts runs them on RethinkDB)
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

import {expect} from 'chai'
import sinon from 'sinon'

import logger from '../../../lib/util/logger.js'
import zebrunnerNodes from '../../../lib/util/zebrunner-nodes.js'
import type {NodeDocument} from '../../../lib/db/zebrunner-nodes.js'
import type {DeviceDocument} from '../../../lib/types/stf.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

interface Reply {
  code: number
  body: unknown
}

var dbapi = {
  createNodeInvite: sinon.stub()
, loadNodeInvite: sinon.stub()
, consumeNodeInvite: sinon.stub()
, loadNode: sinon.stub()
, loadNodes: sinon.stub()
, loadNodeByAddress: sinon.stub()
, loadNodeByPublicKey: sinon.stub()
, enrollNode: sinon.stub()
, revokeNode: sinon.stub()
, deleteNode: sinon.stub()
, touchNode: sinon.stub()
, loadNodeKeys: sinon.stub()
, loadRelayDevices: sinon.stub()
, loadDeviceBySerial: sinon.stub()
}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: dbapi})
var controller = await importFresh(
  new URL('../../../lib/units/api/controllers/zebrunner-nodes.js', import.meta.url)
)
restoreDbApi()
restoreDb()

var INTERNAL = 'internal-token'
var KEY = 'ab'.repeat(32)
var TOKEN = zebrunnerNodes.generateNodeToken('node-1')
var ADMIN = {email: 'admin@example.com', privilege: 'admin'}
var USER = {email: 'user@example.com', privilege: 'user'}
var OPTIONS = {
  stfUrl: 'https://mcloud.example.com'
, endpoints: {
    sub: 'tcp://10.0.0.1:7250'
  , push: 'tcp://10.0.0.1:7270'
  , appDealer: 'tcp://10.0.0.1:7160'
  , devDealer: 'tcp://10.0.0.1:7260'
  }
, serverPublicKey: 'f'.repeat(64)
, agentHosts: ['legacy.lan']
, internalToken: INTERNAL
}

function node(fields: Partial<NodeDocument> = {}): NodeDocument {
  return Object.assign({
    label: 'node-1'
  , address: '10.0.0.5'
  , publicKey: KEY
  , tokenHash: zebrunnerNodes.sha256(TOKEN)
  , status: 'active'
  , createdAt: new Date('2026-01-01T00:00:00Z')
  , revokedAt: null
  , lastSeenAt: null
  , generation: 1
  , retiredKeys: []
  }, fields) as NodeDocument
}

interface CallOptions {
  body?: unknown
  user?: object | null
  params?: Record<string, unknown>
  headers?: Record<string, string>
  nodes?: object | undefined
}

// call <route> <options>: the status and the body the route answers with
function call(route: string, options: CallOptions = {}): Promise<Reply> {
  return new Promise<Reply>(function(resolve) {
    var reply: Reply = {code: 200, body: null}
    var params: Record<string, {value: unknown}> = {}
    Object.entries(options.params || {}).forEach(function([name, value]) {
      params[name] = {value: value}
    })
    var req = {
      body: options.body
    , user: typeof options.user === 'undefined' ? ADMIN : options.user
    , swagger: {params: params}
    , headers: options.headers || {}
    , options: {nodes: options.nodes || OPTIONS}
    , ip: '10.0.0.9'
    , path: '/api/v1/' + route
    }
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
    , end: function() {
        resolve(reply)
        return res
      }
    }
    controller[route](req, res)
  })
}

// js-yaml comes with the swagger middleware of the API unit
var yaml = createRequire(import.meta.url)('js-yaml') as {load(text: string): unknown}

describe('zebrunner: node API', function() {
  var logged: string[]

  function onEntry(entry: logger.Entry) {
    logged.push(entry.message)
  }

  beforeEach(function() {
    logged = []
    logger.on('entry', onEntry)
    Object.values(dbapi).forEach(function(stub) {
      stub.reset()
      stub.resolves(null)
    })
    dbapi.createNodeInvite.resolves()
    dbapi.touchNode.resolves()
  })

  afterEach(function() {
    logger.removeListener('entry', onEntry)
  })

  it('should route the paths of the zebrunner-nodes controller to its functions', async function() {
    var swagger = yaml.load(await readFile(
      new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
    , 'utf8'
    )) as {paths: Record<string, Record<string, {operationId?: string, tags?: string[]}>>}
    var routes: Record<string, string[]> = {}
    Object.entries(swagger.paths).forEach(function([path, methods]) {
      if ((methods['x-swagger-router-controller'] as unknown) !== 'zebrunner-nodes') {
        return
      }
      Object.entries(methods).forEach(function([method, operation]) {
        if (operation && operation.operationId) {
          routes[`${method.toUpperCase()} ${path}`] = operation.tags || []
          expect(controller[operation.operationId], operation.operationId).to.be.a('function')
        }
      })
    })
    expect(routes).to.eql({
      'GET /nodes': ['nodes', 'admin']
    , 'POST /nodes/invites': ['nodes', 'admin']
    , 'POST /nodes/enroll': ['nodes']
    , 'POST /nodes/verify': ['nodes', 'admin']
    , 'GET /nodes/relay': ['nodes', 'admin']
    , 'DELETE /nodes/{label}': ['nodes', 'admin']
    , 'POST /nodes/{label}/revoke': ['nodes', 'admin']
    , 'GET /zebrunner/screen-auth': ['user']
    , 'GET /zebrunner/nodes/keys': ['nodes']
    , 'POST /zebrunner/nodes/token': ['nodes']
    })
    // authenticated by the API unit except the enrollment (an invite) and the internal routes
    ;['/nodes/enroll', '/zebrunner/nodes/keys', '/zebrunner/nodes/token'].forEach(function(path) {
      Object.values(swagger.paths[path]!).forEach(function(operation) {
        if (operation && typeof operation === 'object') {
          expect(operation, path).to.not.have.property('security')
        }
      })
    })
  })

  describe('POST /nodes/invites', function() {
    it('should create an invite of the label and the address', async function() {
      var before = Date.now()
      var reply = await call('createNodeInvite', {
        body: {label: 'node-1', address: 'Node-1.LAN', ttlMinutes: 30}
      })
      expect(reply.code).to.equal(201)
      var body = reply.body as {invite: string, expiresAt: string}
      expect(body).to.include({label: 'node-1', address: 'node-1.lan'})
      expect(body.invite).to.match(/^mci1\./)
      var expiresAt = new Date(body.expiresAt).getTime()
      expect(expiresAt).to.be.within(before + 30 * 60000, Date.now() + 30 * 60000)
      var stored = dbapi.createNodeInvite.firstCall.args[0]
      expect(stored).to.eql({
        hash: zebrunnerNodes.sha256(body.invite)
      , label: 'node-1'
      , address: 'node-1.lan'
      , expiresAt: new Date(expiresAt)
      , createdBy: 'admin@example.com'
      })
      expect(logged.join('\n')).to.not.include(body.invite)
    })

    it('should take 60 minutes by default and up to 1440', async function() {
      var reply = await call('createNodeInvite', {body: {label: 'node-1', address: '10.0.0.5'}})
      var ttl = new Date((reply.body as {expiresAt: string}).expiresAt).getTime() - Date.now()
      expect(ttl).to.be.within(59 * 60000, 60 * 60000)
      expect((await call('createNodeInvite', {
        body: {label: 'node-1', address: '10.0.0.5', ttlMinutes: 1440}
      })).code).to.equal(201)
    })

    var invalid: Array<[string, object]> = [
      ['an invalid label', {label: 'Node 1', address: '10.0.0.5'}]
    , ['a reserved label', {label: 'relay', address: '10.0.0.5'}]
    , ['a loopback address', {label: 'node-1', address: '127.0.0.1'}]
    , ['the metadata address', {label: 'node-1', address: '169.254.169.254'}]
    , ['an address with a port', {label: 'node-1', address: '10.0.0.5:7400'}]
    , ['an address with a scheme', {label: 'node-1', address: 'http://10.0.0.5'}]
    , ['no address', {label: 'node-1'}]
    , ['a ttl of 0', {label: 'node-1', address: '10.0.0.5', ttlMinutes: 0}]
    , ['a ttl over a day', {label: 'node-1', address: '10.0.0.5', ttlMinutes: 1441}]
    , ['a ttl that is not an integer', {label: 'node-1', address: '10.0.0.5', ttlMinutes: '5'}]
    ]

    invalid.forEach(function([what, body]) {
      it(`should refuse ${what} with a generic error`, async function() {
        var reply = await call('createNodeInvite', {body: body})
        expect(reply).to.eql({code: 400, body: {success: false}})
        expect(dbapi.createNodeInvite.called).to.equal(false)
      })
    })

    it('should refuse the address of another node', async function() {
      dbapi.loadNodeByAddress.resolves(node({label: 'node-2'}))
      var reply = await call('createNodeInvite', {body: {label: 'node-1', address: '10.0.0.5'}})
      expect(reply).to.eql({code: 400, body: {success: false}})
      // its own address: a re-enrollment
      dbapi.loadNodeByAddress.resolves(node())
      expect((await call('createNodeInvite', {
        body: {label: 'node-1', address: '10.0.0.5'}
      })).code).to.equal(201)
    })

    it('should not invite without the settings of the enrollment', async function() {
      var reply = await call('createNodeInvite', {
        body: {label: 'node-1', address: '10.0.0.5'}
      , nodes: Object.assign({}, OPTIONS, {endpoints: {sub: 'tcp://a:1'}})
      })
      expect(reply).to.eql({code: 500, body: {success: false}})
      expect(logged.join('\n')).to.include('--nodes-connect-push')
    })
  })

  describe('POST /nodes/enroll', function() {
    var INVITE = zebrunnerNodes.generateInvite()
    var invite = {
      hash: zebrunnerNodes.sha256(INVITE)
    , label: 'node-1'
    , address: '10.0.0.5'
    , expiresAt: new Date(Date.now() + 60000)
    , usedAt: null
    , createdBy: 'admin@example.com'
    }

    beforeEach(function() {
      dbapi.loadNodeInvite.resolves(invite)
      dbapi.consumeNodeInvite.resolves(Object.assign({}, invite, {usedAt: new Date()}))
      dbapi.enrollNode.callsFake(function(fields: Partial<NodeDocument>) {
        return Promise.resolve(node(Object.assign({}, fields, {generation: 1})))
      })
    })

    var ENROLL = {invite: INVITE, label: 'node-1', publicKey: KEY.toUpperCase()}

    function enroll(body: object = ENROLL) {
      return call('enrollNode', {body: body, user: null})
    }

    it('should enroll the node of the invite and give it its token once', async function() {
      var reply = await enroll()
      expect(reply.code).to.equal(200)
      var body = reply.body as {nodeToken: string}
      expect(body.nodeToken).to.match(/^mcn1\.node-1\.[A-Za-z0-9_-]{43}$/)
      expect(body).to.eql({
        nodeToken: body.nodeToken
      , label: 'node-1'
      , address: '10.0.0.5'
      , serverPublicKey: 'f'.repeat(64)
      , stfUrl: 'https://mcloud.example.com'
      , endpoints: OPTIONS.endpoints
      })
      expect(dbapi.consumeNodeInvite.calledOnceWith(invite.hash, 'node-1')).to.equal(true)
      expect(dbapi.enrollNode.firstCall.args[0]).to.eql({
        label: 'node-1'
      , address: '10.0.0.5'
      , publicKey: KEY
      , tokenHash: zebrunnerNodes.sha256(body.nodeToken)
      })
      var log = logged.join('\n')
      expect(log).to.include('Node "node-1" at "10.0.0.5" enrolled')
      expect(log).to.not.include(body.nodeToken.split('.')[2])
      expect(log).to.not.include(INVITE)
    })

    it('should answer a malformed request without the database', async function() {
      var malformed = [
        {}
      , {invite: 'mci1.short', label: 'node-1', publicKey: KEY}
      , {invite: INVITE, label: 'Node-1', publicKey: KEY}
      , {invite: INVITE, label: 'node-1', publicKey: 'xyz'}
      , {invite: INVITE, label: 'node-1', publicKey: KEY + '00'}
      , {invite: [INVITE], label: 'node-1', publicKey: KEY}
      ]
      for (var body of malformed) {
        expect(await enroll(body), JSON.stringify(body)).to.eql({code: 400, body: {success: false}})
      }
      expect(dbapi.loadNodeInvite.called).to.equal(false)
    })

    var refused: Array<[string, () => void]> = [
      ['an unknown invite', function() {
        dbapi.loadNodeInvite.resolves(null)
      }]
    , ['a used invite', function() {
        dbapi.loadNodeInvite.resolves(Object.assign({}, invite, {usedAt: new Date()}))
      }]
    , ['an expired invite', function() {
        dbapi.loadNodeInvite.resolves(Object.assign({}, invite, {
          expiresAt: new Date(Date.now() - 1)
        }))
      }]
    , ['an invite of another label', function() {
        dbapi.loadNodeInvite.resolves(Object.assign({}, invite, {label: 'node-2'}))
      }]
    , ['the key of another node', function() {
        dbapi.loadNodeByPublicKey.resolves(node({label: 'node-2'}))
      }]
    , ['the address of another node', function() {
        dbapi.loadNodeByAddress.resolves(node({label: 'node-2'}))
      }]
    , ['an invite used meanwhile', function() {
        dbapi.consumeNodeInvite.resolves(null)
      }]
    ]

    refused.forEach(function([what, setup]) {
      it(`should refuse ${what} with a generic error`, async function() {
        setup()
        expect(await enroll()).to.eql({code: 403, body: {success: false}})
        expect(dbapi.enrollNode.called).to.equal(false)
        expect(logged.join('\n')).to.not.include(INVITE)
      })
    })

    it('should not use the invite when the key or the address is refused', async function() {
      dbapi.loadNodeByPublicKey.resolves(node({label: 'node-2'}))
      await enroll()
      expect(dbapi.consumeNodeInvite.called).to.equal(false)
    })

    it('should re-enroll a node with its own key or address', async function() {
      dbapi.loadNodeByPublicKey.resolves(node())
      dbapi.loadNodeByAddress.resolves(node())
      expect((await enroll()).code).to.equal(200)
    })

    it('should not enroll without the settings of the enrollment', async function() {
      var reply = await call('enrollNode', {
        body: {invite: INVITE, label: 'node-1', publicKey: KEY}
      , user: null
      , nodes: Object.assign({}, OPTIONS, {stfUrl: ''})
      })
      expect(reply).to.eql({code: 500, body: {success: false}})
      expect(dbapi.consumeNodeInvite.called).to.equal(false)
    })

    it('should check and enroll one node at a time', async function() {
      var order: string[] = []
      var release: () => void = function() {}
      dbapi.loadNodeByPublicKey.callsFake(function(key: string) {
        order.push('check ' + key.slice(0, 2))
        if (key.startsWith('ab')) {
          return new Promise(function(resolve) {
            release = function() {
              resolve(null)
            }
          })
        }
        return Promise.resolve(null)
      })
      dbapi.enrollNode.callsFake(function(fields: Partial<NodeDocument>) {
        order.push('enroll ' + fields.publicKey!.slice(0, 2))
        return Promise.resolve(node(fields))
      })
      var first = enroll()
      var second = enroll({invite: INVITE, label: 'node-1', publicKey: 'cd'.repeat(32)})
      await new Promise(function(resolve) {
        setTimeout(resolve, 20)
      })
      expect(order).to.eql(['check ab'])
      release()
      await Promise.all([first, second])
      expect(order).to.eql(['check ab', 'enroll ab', 'check cd', 'enroll cd'])
    })
  })

  describe('GET /nodes, revoke and delete', function() {
    it('should list the nodes without their token hash', async function() {
      dbapi.loadNodes.resolves([node({lastSeenAt: new Date('2026-02-01T00:00:00Z')})])
      var reply = await call('getNodes')
      expect(reply).to.eql({code: 200, body: {nodes: [{
        label: 'node-1'
      , address: '10.0.0.5'
      , publicKey: KEY
      , status: 'active'
      , createdAt: '2026-01-01T00:00:00.000Z'
      , revokedAt: null
      , lastSeenAt: '2026-02-01T00:00:00.000Z'
      }]}})
    })

    it('should revoke a node', async function() {
      dbapi.revokeNode.resolves(true)
      expect(await call('revokeNode', {params: {label: 'node-1'}}))
        .to.eql({code: 200, body: {success: true}})
      expect(dbapi.revokeNode.calledOnceWith('node-1')).to.equal(true)
      dbapi.revokeNode.resolves(false)
      expect(await call('revokeNode', {params: {label: 'node-2'}}))
        .to.eql({code: 400, body: {success: false}})
      expect(await call('revokeNode', {params: {label: 'Bad Label'}}))
        .to.eql({code: 400, body: {success: false}})
    })

    it('should delete a revoked node only', async function() {
      dbapi.deleteNode.resolves(true)
      expect(await call('deleteNode', {params: {label: 'node-1'}}))
        .to.eql({code: 200, body: {success: true}})
      dbapi.deleteNode.resolves(false)
      expect(await call('deleteNode', {params: {label: 'node-1'}}))
        .to.eql({code: 400, body: {success: false}})
    })

    it('should answer a generic error when the database fails', async function() {
      dbapi.loadNodes.rejects(new Error('database down'))
      expect(await call('getNodes')).to.eql({code: 500, body: {success: false}})
    })
  })

  describe('POST /nodes/verify', function() {
    beforeEach(function() {
      dbapi.loadNode.withArgs('node-1').resolves(node())
    })

    it('should answer the node of a token at its address', async function() {
      expect(await call('verifyNode', {body: {token: TOKEN, host: '10.0.0.5'}}))
        .to.eql({code: 200, body: {label: 'node-1', address: '10.0.0.5'}})
      expect(dbapi.touchNode.calledOnceWith('node-1', 60000)).to.equal(true)
      dbapi.loadNode.withArgs('node-1').resolves(node({address: 'node-1.lan'}))
      expect((await call('verifyNode', {body: {token: TOKEN, host: 'Node-1.LAN'}})).code)
        .to.equal(200)
    })

    var refused: Array<[string, object, (() => void)?]> = [
      ['another host', {token: TOKEN, host: '10.0.0.6'}]
    , ['no host', {token: TOKEN}]
    , ['another secret', {token: zebrunnerNodes.generateNodeToken('node-1'), host: '10.0.0.5'}]
    , ['an unknown node', {token: zebrunnerNodes.generateNodeToken('node-2'), host: '10.0.0.5'}]
    , ['the shared legacy token', {token: 'legacy-secret', host: '10.0.0.5'}]
    , ['a revoked node', {token: TOKEN, host: '10.0.0.5'}, function() {
        dbapi.loadNode.withArgs('node-1').resolves(node({status: 'revoked'}))
      }]
    ]

    refused.forEach(function([what, body, setup]) {
      it(`should refuse ${what}`, async function() {
        if (setup) {
          setup()
        }
        expect(await call('verifyNode', {body: body})).to.eql({code: 403, body: {success: false}})
        expect(dbapi.touchNode.called).to.equal(false)
        expect(logged.join('\n')).to.not.include(TOKEN.split('.')[2])
      })
    })
  })

  it('should list the devices of the relay', async function() {
    var devices = [{serial: 's', label: 'node-1', address: '10.0.0.5', connectPort: 7405}]
    dbapi.loadRelayDevices.resolves(devices)
    expect(await call('getNodeRelay')).to.eql({code: 200, body: {devices: devices}})
  })

  describe('internal routes', function() {
    beforeEach(function() {
      dbapi.loadNode.withArgs('node-1').resolves(node())
      dbapi.loadNodeKeys.resolves({allowed: [KEY], denied: []})
    })

    it('should answer the keys and check the tokens for the server units', async function() {
      var headers = {'x-stf-internal-token': INTERNAL}
      expect(await call('getNodeKeys', {headers: headers, user: null}))
        .to.eql({code: 200, body: {allowed: [KEY], denied: []}})
      expect(await call('checkNodeToken', {headers: headers, user: null, body: {token: TOKEN}}))
        .to.eql({code: 200, body: {label: 'node-1'}})
      expect(await call('checkNodeToken', {
        headers: headers
      , user: null
      , body: {token: zebrunnerNodes.generateNodeToken('node-1')}
      })).to.eql({code: 403, body: {success: false}})
    })

    var callers: Array<[string, Record<string, string>, object?]> = [
      ['no token', {}]
    , ['another token', {'x-stf-internal-token': 'wrong'}]
    , ['a node token', {'x-stf-internal-token': TOKEN}]
    , ['a token when none is configured', {'x-stf-internal-token': ''}
      , Object.assign({}, OPTIONS, {internalToken: ''})]
    ]

    callers.forEach(function([what, headers, nodes]) {
      it(`should refuse ${what}`, async function() {
        var options = {headers: headers, user: null, body: {token: TOKEN}, nodes: nodes}
        expect(await call('getNodeKeys', options)).to.eql({code: 403, body: {success: false}})
        expect(await call('checkNodeToken', options)).to.eql({code: 403, body: {success: false}})
        expect(dbapi.loadNodeKeys.called).to.equal(false)
      })
    })
  })

  describe('GET /zebrunner/screen-auth', function() {
    var URI = '/d/10.0.0.5/serial1/7404/'
    var target = {host: '10.0.0.5', serial: 'serial1', port: 7404}

    function device(fields: Partial<DeviceDocument> = {}): DeviceDocument {
      return Object.assign({
        serial: 'serial1'
      , owner: {email: USER.email, name: 'user', group: ''}
      , screenPort: 7404
      , connectPort: 7405
      , node: 'node-1'
      , nodeGeneration: 1
      , display: {url: 'wss://mcloud/d/10.0.0.5/serial1/7404/'}
      }, fields) as unknown as DeviceDocument
    }

    function decide(
      fields: Partial<DeviceDocument> | null
    , options: {
        user?: {email: string, privilege: string}
        node?: NodeDocument | null
        hostNode?: NodeDocument | null
        target?: typeof target
      } = {}
    ) {
      return controller.screenDecision(
        options.user || USER
      , options.target || target
      , fields ? device(fields) : null
      , typeof options.node === 'undefined' ? node() : options.node
      , typeof options.hostNode === 'undefined' ? node() : options.hostNode
      , ['legacy.lan', '10.0.0.7']
      ).allowed
    }

    it('should let the user of a device bound to the node of the host see its screen', function() {
      expect(decide({})).to.equal(true)
      expect(decide({}, {target: {host: '10.0.0.5', serial: 'serial1', port: 7404}})).to.equal(true)
    })

    it('should let an admin see any screen of a bound device', function() {
      expect(decide({owner: null}, {user: ADMIN})).to.equal(true)
      expect(decide({owner: null})).to.equal(false)
    })

    it('should refuse the screen of a device of another user', function() {
      expect(decide({owner: {email: 'other@example.com', name: 'o', group: ''}})).to.equal(false)
    })

    it('should refuse another host, port or an unknown device', function() {
      expect(decide({}, {target: Object.assign({}, target, {host: '10.0.0.6'})})).to.equal(false)
      expect(decide({}, {target: Object.assign({}, target, {port: 7405})})).to.equal(false)
      expect(decide({screenPort: null})).to.equal(false)
      expect(decide(null)).to.equal(false)
      expect(controller.screenDecision(USER, null, device(), node(), node(), []).allowed)
        .to.equal(false)
    })

    it('should refuse a device whose node was revoked or rotated', function() {
      expect(decide({}, {node: node({status: 'revoked'}), hostNode: node({status: 'revoked'})}))
        .to.equal(false)
      expect(decide({nodeGeneration: 0})).to.equal(false)
      expect(decide({node: null, nodeGeneration: null})).to.equal(false)
    })

    describe('legacy devices', function() {
      var legacy = {host: 'legacy.lan', serial: 'serial1', port: 7404}

      function decideLegacy(fields: Partial<DeviceDocument>, hostNode: NodeDocument | null = null) {
        return decide(Object.assign({
          node: null
        , nodeGeneration: null
        , display: {url: 'wss://mcloud/d/legacy.lan/serial1/7404/'}
        }, fields), {node: null, hostNode: hostNode, target: legacy})
      }

      it('should let the user see the screen of an unbound device of AGENT_HOSTS', function() {
        expect(decideLegacy({})).to.equal(true)
        // an old device unit without the ports: its screen URL tells them
        expect(decideLegacy({screenPort: null})).to.equal(true)
      })

      it('should refuse a host that is not in AGENT_HOSTS', function() {
        expect(decide({node: null}, {
          node: null
        , hostNode: null
        , target: {host: 'other.lan', serial: 'serial1', port: 7404}
        })).to.equal(false)
      })

      it('should refuse a host of AGENT_HOSTS that is the address of a node', function() {
        expect(decideLegacy({}, node({address: 'legacy.lan'}))).to.equal(false)
        expect(decideLegacy({}, node({address: 'legacy.lan', status: 'revoked'}))).to.equal(false)
      })

      it('should refuse the screen of another device or port', function() {
        expect(decideLegacy({screenPort: 7408})).to.equal(false)
        expect(decideLegacy({display: {url: 'wss://mcloud/d/10.0.0.7/serial1/7404/'}}))
          .to.equal(false)
        expect(decideLegacy({display: {url: 'wss://mcloud/d/legacy.lan/serial2/7404/'}}))
          .to.equal(false)
        expect(decideLegacy({screenPort: null, display: {}})).to.equal(false)
        expect(decideLegacy({display: {url: 'not a URL'}})).to.equal(false)
      })
    })

    it('should answer nginx 204 or 403, without a body', async function() {
      dbapi.loadDeviceBySerial.withArgs('serial1').resolves(device())
      dbapi.loadNode.withArgs('node-1').resolves(node())
      dbapi.loadNodeByAddress.withArgs('10.0.0.5').resolves(node())
      expect(await call('getScreenAuth', {user: USER, headers: {'x-original-uri': URI}}))
        .to.eql({code: 204, body: null})
      expect(await call('getScreenAuth', {
        user: {email: 'other@example.com', privilege: 'user'}
      , headers: {'x-original-uri': URI}
      })).to.eql({code: 403, body: null})
      expect(await call('getScreenAuth', {user: USER, headers: {'x-original-uri': '/d/x'}}))
        .to.eql({code: 403, body: null})
      expect(await call('getScreenAuth', {user: USER})).to.eql({code: 403, body: null})
      expect(await call('getScreenAuth', {user: null, headers: {'x-original-uri': URI}}))
        .to.eql({code: 401, body: null})
      expect(logged.join('\n')).to.include('Refused the screen /d/10.0.0.5/serial1/7404/ to other@')
    })
  })
})
