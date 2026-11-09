// Fork (Zebrunner): the enrolled nodes against a real RethinkDB (lib/db/zebrunner-nodes.ts) and
// through the API unit with its swagger routes (lib/units/api/controllers/zebrunner-nodes.ts).
// Runs when STF_TEST_RETHINKDB is the address of a RethinkDB (tcp://127.0.0.1:28015, CI); every
// run uses a database of its own and drops it.
import crypto from 'node:crypto'

import {spawn, type ChildProcess} from 'node:child_process'
import net from 'node:net'
import {fileURLToPath} from 'node:url'

import {expect} from 'chai'
import r from 'rethinkdb'

import jwtutil from '../../../lib/util/jwtutil.js'
import zebrunnerNodes from '../../../lib/util/zebrunner-nodes.js'
import zmqcurve from '../../../lib/util/zmqcurve.js'
import type DbApi from '../../../lib/db/api.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'
import {sessionCookie} from '../../helpers/zebrunner.mts'

var address = process.env.STF_TEST_RETHINKDB
var SECRET = 'nodes-api-secret'
var INTERNAL = 'nodes-internal-token'
var ADMIN = 'admin@example.com'
var USER = 'user@example.com'

function freePort(): Promise<number> {
  return new Promise(function(resolve, reject) {
    var server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', function() {
      var port = (server.address() as net.AddressInfo).port
      server.close(function() {
        resolve(port)
      })
    })
  })
}

function key() {
  return crypto.randomBytes(32).toString('hex')
}

(address ? describe : describe.skip)('zebrunner: nodes with RethinkDB', function() {
  this.timeout(30000)

  var conn: r.Connection
   , dbapi: typeof DbApi
  var database = 'stf_test_nodes_' + crypto.randomBytes(4).toString('hex')
  var restore: Array<() => void> = []

  function run<T>(query: r.Operation<T>) {
    return query.run(conn)
  }

  before(async function() {
    var url = new URL(address!)
    conn = await r.connect({host: url.hostname, port: Number(url.port || 28015), db: database})
    // the queries of dbapi run on this connection: lib/db/index.js would connect (and reconnect) by
    // itself and keep the process alive
    restore.push(mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {
      run: function(query: r.Operation<unknown>) {
        return query.run(conn)
      }
    , connect: function() {
        return Promise.resolve(conn)
      }
    , ensureConnectivity: function(fn: unknown) {
        return fn
      }
    }}))
    dbapi = (await importFresh(new URL('../../../lib/db/api.js', import.meta.url))).default
    var setup = (await import('../../../lib/db/setup.js')).default
    await setup(conn)
  })

  after(async function() {
    restore.forEach(function(undo) {
      undo()
    })
    if (conn) {
      await r.dbDrop(database).run(conn)
      await conn.close()
    }
  })

  beforeEach(async function() {
    await run(r.table('nodes').delete())
    await run(r.table('node_invites').delete())
    await run(r.table('devices').delete())
  })

  function invite(label: string, fields: Partial<{address: string, expiresAt: Date}> = {}) {
    var secret = zebrunnerNodes.generateInvite()
    var hash = zebrunnerNodes.sha256(secret)
    return dbapi.createNodeInvite({
      hash: hash
    , label: label
    , address: fields.address || `${label}.lan`
    , expiresAt: fields.expiresAt || new Date(Date.now() + 60000)
    , createdBy: ADMIN
    }).then(function() {
      return hash
    })
  }

  describe('invites', function() {
    it('should use an invite once, of all the concurrent enrollments', async function() {
      var hash = await invite('node-1')
      var results = await Promise.all(Array.from({length: 20}, function() {
        return dbapi.consumeNodeInvite(hash, 'node-1')
      }))
      var used = results.filter(Boolean)
      expect(used).to.have.length(1)
      expect(used[0]!.address).to.equal('node-1.lan')
      expect(await dbapi.consumeNodeInvite(hash, 'node-1')).to.equal(null)
    })

    it('should not use an invite of another label, an expired or an unknown one', async function() {
      var hash = await invite('node-1')
      expect(await dbapi.consumeNodeInvite(hash, 'node-2')).to.equal(null)
      expect((await dbapi.loadNodeInvite(hash))!.usedAt).to.equal(null)
      var expired = await invite('node-3', {expiresAt: new Date(Date.now() - 1000)})
      expect(await dbapi.consumeNodeInvite(expired, 'node-3')).to.equal(null)
      expect(await dbapi.consumeNodeInvite(zebrunnerNodes.sha256('x'), 'node-1')).to.equal(null)
      expect(await dbapi.consumeNodeInvite(hash, 'node-1')).to.not.equal(null)
    })

    it('should invalidate the other outstanding invites of the label', async function() {
      var first = await invite('node-1')
      var other = await invite('node-2')
      var second = await invite('node-1')
      expect(await dbapi.loadNodeInvite(first)).to.equal(null)
      expect(await dbapi.loadNodeInvite(second)).to.not.equal(null)
      expect(await dbapi.loadNodeInvite(other)).to.not.equal(null)
    })
  })

  describe('nodes', function() {
    it('should enroll a node and re-enroll it with a new key and token', async function() {
      var first = key()
      var node = await dbapi.enrollNode({
        label: 'node-1'
      , address: 'Node-1.LAN'
      , publicKey: first.toUpperCase()
      , tokenHash: 'a'.repeat(64)
      })
      expect(node).to.include({
        label: 'node-1', address: 'node-1.lan', publicKey: first, status: 'active', generation: 1
      })
      expect(node.retiredKeys).to.eql([])
      await dbapi.revokeNode('node-1')

      var second = key()
      node = await dbapi.enrollNode({
        label: 'node-1', address: '10.0.0.7', publicKey: second, tokenHash: 'b'.repeat(64)
      })
      expect(node).to.include({
        address: '10.0.0.7', publicKey: second, tokenHash: 'b'.repeat(64), status: 'active'
      , generation: 2, revokedAt: null
      })
      expect(node.retiredKeys).to.eql([first])
      expect((await dbapi.loadNodeByPublicKey(first))!.label).to.equal('node-1')
      expect((await dbapi.loadNodeByAddress('10.0.0.7'))!.label).to.equal('node-1')
      expect(await dbapi.loadNodeByAddress('node-1.lan')).to.equal(null)

      // back to the first key: it is not retired any more
      node = await dbapi.enrollNode({
        label: 'node-1', address: '10.0.0.7', publicKey: first, tokenHash: 'c'.repeat(64)
      })
      expect(node.generation).to.equal(3)
      expect(node.retiredKeys).to.eql([second])
      expect(await dbapi.loadNodeKeys()).to.eql({allowed: [first], denied: [second]})
    })

    it('should revoke a node: no invites, no bound devices, its key refused', async function() {
      var publicKey = key()
      await dbapi.enrollNode({
        label: 'node-1', address: 'node-1.lan', publicKey: publicKey, tokenHash: 'a'.repeat(64)
      })
      await invite('node-1')
      await run(r.table('devices').insert([
        {serial: 'a', node: 'node-1', nodeGeneration: 1}
      , {serial: 'b', node: 'node-2', nodeGeneration: 1}
      ]))

      expect(await dbapi.revokeNode('node-1')).to.equal(true)
      expect(await dbapi.revokeNode('node-1')).to.equal(true)
      expect(await dbapi.revokeNode('unknown')).to.equal(false)

      var node = await dbapi.loadNode('node-1')
      expect(node!.status).to.equal('revoked')
      expect(node!.revokedAt).to.be.instanceOf(Date)
      expect(await run(r.table('node_invites').count())).to.equal(0)
      expect(await run(r.table('devices').get('a'))).to.include({node: null, nodeGeneration: null})
      expect(await run(r.table('devices').get('b'))).to.include({node: 'node-2'})
      expect(await dbapi.loadNodeKeys()).to.eql({allowed: [], denied: [publicKey]})
    })

    it('should delete a revoked node only', async function() {
      await dbapi.enrollNode({
        label: 'node-1', address: 'node-1.lan', publicKey: key(), tokenHash: 'a'.repeat(64)
      })
      expect(await dbapi.deleteNode('node-1')).to.equal(false)
      expect(await dbapi.loadNode('node-1')).to.not.equal(null)
      await dbapi.revokeNode('node-1')
      expect(await dbapi.deleteNode('node-1')).to.equal(true)
      expect(await dbapi.loadNode('node-1')).to.equal(null)
      expect(await dbapi.deleteNode('node-1')).to.equal(false)
    })

    it('should write the last time a node was seen once per interval', async function() {
      await dbapi.enrollNode({
        label: 'node-1', address: 'node-1.lan', publicKey: key(), tokenHash: 'a'.repeat(64)
      })
      await dbapi.touchNode('node-1', 60000)
      var seen = (await dbapi.loadNode('node-1'))!.lastSeenAt
      expect(seen).to.be.instanceOf(Date)
      await dbapi.touchNode('node-1', 60000)
      expect((await dbapi.loadNode('node-1'))!.lastSeenAt!.getTime()).to.equal(seen!.getTime())
      await new Promise(function(resolve) {
        setTimeout(resolve, 20)
      })
      await dbapi.touchNode('node-1', 1)
      expect((await dbapi.loadNode('node-1'))!.lastSeenAt!.getTime()).to.be.above(seen!.getTime())
    })

    it('should list the present Android devices of active nodes for the relay', async function() {
      await dbapi.enrollNode({
        label: 'node-1', address: 'node-1.lan', publicKey: key(), tokenHash: 'a'.repeat(64)
      })
      await dbapi.enrollNode({
        label: 'node-2', address: 'node-2.lan', publicKey: key(), tokenHash: 'b'.repeat(64)
      })
      await dbapi.revokeNode('node-2')
      var android = {present: true, platform: 'Android', node: 'node-1', nodeGeneration: 1}
      await run(r.table('devices').insert([
        Object.assign({serial: 'b', connectPort: 7405}, android)
      , Object.assign({serial: 'a', connectPort: 7409}, android, {
          display: {url: 'ws://elsewhere/d/evil/a/7404/'}
        })
      , Object.assign({serial: 'absent', connectPort: 7413}, android, {present: false})
      , Object.assign({serial: 'ios', connectPort: 7417}, android, {platform: 'iOS'})
      , Object.assign({serial: 'old', connectPort: 7421}, android, {nodeGeneration: 0})
      , Object.assign({serial: 'revoked', connectPort: 7425}, android, {node: 'node-2'})
      , Object.assign({serial: 'legacy', connectPort: 7429}, android, {node: null})
      , Object.assign({serial: 'noport'}, android)
      ]))
      expect(await dbapi.loadRelayDevices()).to.eql([
        {serial: 'a', label: 'node-1', address: 'node-1.lan', connectPort: 7409}
      , {serial: 'b', label: 'node-1', address: 'node-1.lan', connectPort: 7405}
      ])
    })

    it('should keep the ports and the node of a device, or reject it', async function() {
      await run(r.table('devices').insert({serial: 's', screenPort: 1, connectPort: 2}))
      await dbapi.setDevicePorts(
        {serial: 's', screenPort: 7404, connectPort: 7405}
      , {node: 'node-1', nodeGeneration: 3}
      )
      expect(await run(r.table('devices').get('s'))).to.include({
        screenPort: 7404, connectPort: 7405, node: 'node-1', nodeGeneration: 3
      })
      await dbapi.rejectDeviceRegistration('s')
      expect(await run(r.table('devices').get('s'))).to.include({
        screenPort: null, connectPort: null, node: null, nodeGeneration: null
      })
    })
  })

  // the stf api command in a process of its own: the swagger runner of the unit requires its
  // controllers and security handlers, which the other tests of this process load with mocks
  describe('API unit', function() {
    var api: {origin: string}
     , child: ChildProcess
    var output = ''
    var publicKey = key()
    // the invites and node tokens the unit answered, which its log must not have
    var secrets = new Set<string>()

    before(async function() {
      var port = await freePort()
      var env: Record<string, string> = {}
      Object.entries(process.env).forEach(function([name, value]) {
        if (!/^(STF_|RETHINKDB_|SECRET$|AGENT_HOSTS$)/.test(name) && typeof value === 'string') {
          env[name] = value
        }
      })
      Object.assign(env, {
        RETHINKDB_PORT_28015_TCP: address!
      , RETHINKDB_ENV_DATABASE: database
      , SECRET: SECRET
      , STF_STORAGE_TOKEN: INTERNAL
      , AGENT_HOSTS: 'legacy.lan'
      , STF_URL: 'https://mcloud.example.com'
      , STF_ZMQ_CURVE_SERVER_PUBLIC_KEY: 'f'.repeat(64)
      , STF_ZMQ_CURVE_SECRET_KEY: zmqcurve.generateKeyPair().secretKey
      })
      child = spawn(process.execPath, [
        fileURLToPath(new URL('../../../lib/cli/index.js', import.meta.url))
      , 'api'
      , '--port', String(port)
      , '--connect-push', 'tcp://127.0.0.1:1', '--connect-sub', 'tcp://127.0.0.1:1'
      , '--connect-push-dev', 'tcp://127.0.0.1:1', '--connect-sub-dev', 'tcp://127.0.0.1:1'
      , '--nodes-connect-sub', 'tcp://10.0.0.1:7250'
      , '--nodes-connect-push', 'tcp://10.0.0.1:7270'
      , '--nodes-connect-app-dealer', 'tcp://10.0.0.1:7160'
      , '--nodes-connect-dev-dealer', 'tcp://10.0.0.1:7260'
      ], {env: env, stdio: ['ignore', 'pipe', 'pipe']})
      child.stdout!.on('data', function(chunk) {
        output += chunk
      })
      child.stderr!.on('data', function(chunk) {
        output += chunk
      })
      api = {origin: `http://127.0.0.1:${port}`}
      // swagger registers its routes once it read the file
      for (var i = 0; i < 100; i++) {
        var res = await fetch(api.origin + '/api/v1/nodes').catch(function() {
          return null
        })
        if (res && res.status !== 404) {
          return
        }
        await new Promise(function(resolve) {
          setTimeout(resolve, 100)
        })
      }
      throw new Error('The API unit did not start:\n' + output)
    })

    after(async function() {
      if (child && child.exitCode === null) {
        var exited = new Promise(function(resolve) {
          child.once('exit', resolve)
        })
        child.kill('SIGKILL')
        await exited
      }
    })

    beforeEach(async function() {
      await run(r.table('users').delete())
      await run(r.table('accessTokens').delete())
      await run(r.table('sessions').delete())
      await run(r.table('users').insert([
        {email: ADMIN, name: 'admin', privilege: 'admin'}
      , {email: USER, name: 'user', privilege: 'user'}
      ]))
      await run(r.table('accessTokens').insert([ADMIN, USER].map(function(email) {
        return {
          id: email
        , email: email
        , jwt: jwtutil.encode({payload: {email: email, name: email}, secret: SECRET})
        }
      })))
    })

    function call(method: string, path: string, options: {
      as?: string
      body?: unknown
      headers?: Record<string, string>
    } = {}) {
      var headers: Record<string, string> = Object.assign({}, options.headers)
      if (options.as) {
        headers.authorization = 'Bearer ' + options.as
      }
      if (typeof options.body !== 'undefined') {
        headers['content-type'] = 'application/json'
      }
      return fetch(api.origin + '/api/v1' + path, {
        method: method
      , headers: headers
      , body: typeof options.body === 'undefined' ? null : JSON.stringify(options.body)
      }).then(async function(res) {
        var text = await res.clone().text()
        ;(text.match(/mc[in]1\.[A-Za-z0-9._-]+/g) || []).forEach(function(secret) {
          secrets.add(secret)
        })
        return res
      })
    }

    async function enroll(label: string, nodeAddress: string, nodeKey = publicKey) {
      var created = await call('POST', '/nodes/invites', {
        as: ADMIN
      , body: {label: label, address: nodeAddress, ttlMinutes: 5}
      })
      expect(created.status).to.equal(201)
      var inviteBody = await created.json() as {invite: string}
      var res = await call('POST', '/nodes/enroll', {
        body: {invite: inviteBody.invite, label: label, publicKey: nodeKey}
      })
      expect(res.status).to.equal(200)
      return await res.json() as {nodeToken: string, address: string}
    }

    it('should enroll a node with an invite of an admin', async function() {
      var res = await call('POST', '/nodes/invites', {
        as: ADMIN
      , body: {label: 'node-1', address: 'Node-1.LAN'}
      })
      expect(res.status).to.equal(201)
      var created = await res.json() as {invite: string, expiresAt: string}
      expect(created).to.include({label: 'node-1', address: 'node-1.lan'})
      expect(created.invite).to.match(/^mci1\.[A-Za-z0-9_-]{43}$/)
      var ttl = new Date(created.expiresAt).getTime() - Date.now()
      expect(ttl).to.be.within(59 * 60000, 60 * 60000)

      var enrolled = await call('POST', '/nodes/enroll', {
        body: {invite: created.invite, label: 'node-1', publicKey: publicKey}
      })
      expect(enrolled.status).to.equal(200)
      var body = await enrolled.json() as {nodeToken: string}
      expect(body.nodeToken).to.match(/^mcn1\.node-1\.[A-Za-z0-9_-]{43}$/)
      expect(body).to.eql({
        nodeToken: body.nodeToken
      , label: 'node-1'
      , address: 'node-1.lan'
      , serverPublicKey: 'f'.repeat(64)
      , stfUrl: 'https://mcloud.example.com'
      , endpoints: {
          sub: 'tcp://10.0.0.1:7250'
        , push: 'tcp://10.0.0.1:7270'
        , appDealer: 'tcp://10.0.0.1:7160'
        , devDealer: 'tcp://10.0.0.1:7260'
        }
      })
      var stored = await dbapi.loadNode('node-1')
      expect(stored!.tokenHash).to.equal(zebrunnerNodes.sha256(body.nodeToken))
      expect(JSON.stringify(stored)).to.not.include(body.nodeToken)
      expect(JSON.stringify(await run(r.table('node_invites').coerceTo('array'))))
        .to.not.include(created.invite)

      // the invite is used
      var again = await call('POST', '/nodes/enroll', {
        body: {invite: created.invite, label: 'node-1', publicKey: publicKey}
      })
      expect(again.status).to.equal(403)
      expect(await again.json()).to.eql({success: false})
    })

    it('should enroll once of concurrent enrollments with one invite', async function() {
      var res = await call('POST', '/nodes/invites', {
        as: ADMIN
      , body: {label: 'node-1', address: 'node-1.lan'}
      })
      var created = await res.json() as {invite: string}
      var results = await Promise.all(Array.from({length: 10}, function() {
        return call('POST', '/nodes/enroll', {
          body: {invite: created.invite, label: 'node-1', publicKey: key()}
        }).then(function(answer) {
          return answer.status
        })
      }))
      expect(results.filter(function(status) {
        return status === 200
      })).to.have.length(1)
      expect(results.filter(function(status) {
        return status === 403
      })).to.have.length(9)
      expect((await dbapi.loadNode('node-1'))!.generation).to.equal(1)
    })

    it('should refuse the node routes to the users and unauthenticated callers', async function() {
      expect((await call('GET', '/nodes', {as: USER})).status).to.equal(403)
      expect((await call('GET', '/nodes')).status).to.equal(401)
      expect((await call('GET', '/nodes/relay', {as: USER})).status).to.equal(403)
      expect((await call('POST', '/nodes/verify', {as: USER, body: {}})).status).to.equal(403)
      expect((await call('POST', '/nodes/invites', {
        as: USER
      , body: {label: 'node-1', address: 'node-1.lan'}
      })).status).to.equal(403)
      expect((await call('POST', '/nodes/node-1/revoke', {as: USER})).status).to.equal(403)
      expect((await call('DELETE', '/nodes/node-1', {as: USER})).status).to.equal(403)
      expect((await call('GET', '/zebrunner/nodes/keys')).status).to.equal(403)
      expect((await call('GET', '/zebrunner/nodes/keys', {
        headers: {'x-stf-internal-token': 'wrong'}
      })).status).to.equal(403)
    })

    it('should verify, list, relay, revoke and delete a node', async function() {
      var enrolled = await enroll('node-1', '10.0.0.5')
      await run(r.table('devices').insert({
        serial: 'emulator-5554', present: true, platform: 'Android', screenPort: 7404
      , connectPort: 7405, node: 'node-1', nodeGeneration: 1, owner: {email: USER}
      }))

      var verify = await call('POST', '/nodes/verify', {
        as: ADMIN
      , body: {token: enrolled.nodeToken, host: '10.0.0.5'}
      })
      expect(verify.status).to.equal(200)
      expect(await verify.json()).to.eql({label: 'node-1', address: '10.0.0.5'})
      expect((await call('POST', '/nodes/verify', {
        as: ADMIN
      , body: {token: enrolled.nodeToken, host: '10.0.0.6'}
      })).status).to.equal(403)

      var list = await (await call('GET', '/nodes', {as: ADMIN})).json() as {nodes: object[]}
      expect(list.nodes).to.have.length(1)
      expect(list.nodes[0]).to.include({
        label: 'node-1'
      , address: '10.0.0.5'
      , publicKey: publicKey
      , status: 'active'
      , revokedAt: null
      })
      expect(list.nodes[0]).to.have.all.keys(
        'label', 'address', 'publicKey', 'status', 'createdAt', 'revokedAt', 'lastSeenAt'
      )
      expect((list.nodes[0] as {lastSeenAt: string}).lastSeenAt).to.be.a('string')

      expect(await (await call('GET', '/nodes/relay', {as: ADMIN})).json()).to.eql({
        devices: [
          {serial: 'emulator-5554', label: 'node-1', address: '10.0.0.5', connectPort: 7405}
        ]
      })
      var screen = '/d/10.0.0.5/emulator-5554/7404/'
      expect((await call('GET', '/zebrunner/screen-auth', {
        as: USER
      , headers: {'x-original-uri': screen}
      })).status).to.equal(204)
      var cookie = await sessionCookie(SECRET, {jwt: {
        email: USER, name: 'user', sid: 'sid', expiresAt: Date.now() + 60000
      }})
      await run(r.table('sessions').insert({id: 'sid', email: USER, expiresAt: Date.now() + 60000}))
      expect((await call('GET', '/zebrunner/screen-auth', {
        headers: {'x-original-uri': screen, cookie: cookie}
      })).status).to.equal(204)
      expect((await call('GET', '/zebrunner/screen-auth', {
        headers: {'x-original-uri': screen}
      })).status).to.equal(401)

      var keys = await call('GET', '/zebrunner/nodes/keys', {
        headers: {'x-stf-internal-token': INTERNAL}
      })
      expect(await keys.json()).to.eql({allowed: [publicKey], denied: []})
      var check = await call('POST', '/zebrunner/nodes/token', {
        headers: {'x-stf-internal-token': INTERNAL}
      , body: {token: enrolled.nodeToken}
      })
      expect(check.status).to.equal(200)
      expect((await call('POST', '/zebrunner/nodes/token', {
        headers: {'x-stf-internal-token': enrolled.nodeToken}
      , body: {token: enrolled.nodeToken}
      })).status).to.equal(403)

      expect((await call('DELETE', '/nodes/node-1', {as: ADMIN})).status).to.equal(400)
      expect((await call('POST', '/nodes/node-1/revoke', {as: ADMIN})).status).to.equal(200)
      expect((await call('POST', '/nodes/verify', {
        as: ADMIN
      , body: {token: enrolled.nodeToken, host: '10.0.0.5'}
      })).status).to.equal(403)
      expect(await (await call('GET', '/nodes/relay', {as: ADMIN})).json()).to.eql({devices: []})
      expect((await call('GET', '/zebrunner/screen-auth', {
        as: USER
      , headers: {'x-original-uri': screen}
      })).status).to.equal(403)
      expect(await (await call('GET', '/zebrunner/nodes/keys', {
        headers: {'x-stf-internal-token': INTERNAL}
      })).json()).to.eql({allowed: [], denied: [publicKey]})
      expect((await call('POST', '/zebrunner/nodes/token', {
        headers: {'x-stf-internal-token': INTERNAL}
      , body: {token: enrolled.nodeToken}
      })).status).to.equal(403)

      var deleted = await call('DELETE', '/nodes/node-1', {as: ADMIN})
      expect(deleted.status).to.equal(200)
      expect(await deleted.json()).to.eql({success: true})
      expect(await (await call('GET', '/nodes', {as: ADMIN})).json()).to.eql({nodes: []})
    })

    it('should rotate the token and key of a node with a new invite', async function() {
      var first = await enroll('node-1', 'node-1.lan')
      var otherKey = key()
      var second = await enroll('node-1', 'node-1.lan', otherKey)
      expect(second.nodeToken).to.not.equal(first.nodeToken)
      expect((await call('POST', '/nodes/verify', {
        as: ADMIN
      , body: {token: first.nodeToken, host: 'node-1.lan'}
      })).status).to.equal(403)
      expect((await call('POST', '/nodes/verify', {
        as: ADMIN
      , body: {token: second.nodeToken, host: 'NODE-1.lan'}
      })).status).to.equal(200)
      expect(await (await call('GET', '/zebrunner/nodes/keys', {
        headers: {'x-stf-internal-token': INTERNAL}
      })).json()).to.eql({allowed: [otherKey], denied: [publicKey]})
    })

    it('should refuse the key or the address of another node', async function() {
      await enroll('node-1', 'node-1.lan')
      // the address of node-1
      expect((await call('POST', '/nodes/invites', {
        as: ADMIN
      , body: {label: 'node-2', address: 'NODE-1.lan'}
      })).status).to.equal(400)
      var res = await call('POST', '/nodes/invites', {
        as: ADMIN
      , body: {label: 'node-2', address: 'node-2.lan'}
      })
      var created = await res.json() as {invite: string}
      var refused = await call('POST', '/nodes/enroll', {
        body: {invite: created.invite, label: 'node-2', publicKey: publicKey}
      })
      expect(refused.status).to.equal(403)
      expect(await refused.json()).to.eql({success: false})
      // the invite was not used by the refused enrollment
      expect((await call('POST', '/nodes/enroll', {
        body: {invite: created.invite, label: 'node-2', publicKey: key()}
      })).status).to.equal(200)
    })

    // DELETE /nodes/relay would be answered by the static path of the relay (405)
    it('should not invite a node with the label of a static path', async function() {
      expect((await call('POST', '/nodes/invites', {
        as: ADMIN
      , body: {label: 'relay', address: 'relay.lan'}
      })).status).to.equal(400)
    })

    it('should not have logged an invite or a node token', async function() {
      await new Promise(function(resolve) {
        setTimeout(resolve, 200)
      })
      expect(secrets.size).to.be.above(5)
      expect(output).to.include('enrolled')
      secrets.forEach(function(secret) {
        expect(output).to.not.include(secret.startsWith('mcn1.') ? secret.split('.')[2] : secret)
      })
    })
  })
})
