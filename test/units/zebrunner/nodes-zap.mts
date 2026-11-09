// Fork (Zebrunner): the keys of the enrolled nodes in the ZAP handler of the triproxies
// (lib/util/zmqcurve.ts) and the node tokens of the storage (lib/util/storageauth.ts), both read
// from the API unit by lib/util/zebrunner-nodes-client.ts
import http from 'node:http'
import net from 'node:net'

import {expect} from 'chai'
import express from 'express'
import zmq from 'zeromq/v5-compat.js'

import storageauth from '../../../lib/util/storageauth.js'
import nodesClient, {
  KEYS_INTERVAL
, KEYS_PATH
, TOKEN_TTL
, type NodeKeys
} from '../../../lib/util/zebrunner-nodes-client.js'
import zebrunnerNodes from '../../../lib/util/zebrunner-nodes.js'
import zmqcurve, {type CurveConfig} from '../../../lib/util/zmqcurve.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

var INTERNAL = 'internal-token'
var TOKEN = zebrunnerNodes.generateNodeToken('node-1')

function delay(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

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

// A fake API unit: the internal routes of the nodes, what they answer set by the test
interface FakeApi extends Running {
  keys: NodeKeys | null
  keyStatus: number
  validTokens: Set<string>
  tokenStatus: number
  requests: Array<{path: string, token: string | undefined, body: string}>
}

async function fakeApi(): Promise<FakeApi> {
  var api: Partial<FakeApi> = {
    keys: {allowed: [], denied: []}
  , keyStatus: 200
  , validTokens: new Set()
  , tokenStatus: 0
  , requests: []
  }
  var running = await listen(function(req: http.IncomingMessage, res: http.ServerResponse) {
    var body = ''
    req.on('data', function(chunk) {
      body += chunk
    })
    req.on('end', function() {
      api.requests!.push({
        path: req.url!
      , token: req.headers['x-stf-internal-token'] as string | undefined
      , body: body
      })
      res.setHeader('content-type', 'application/json')
      if (req.headers['x-stf-internal-token'] !== INTERNAL) {
        res.statusCode = 403
        res.end('{"success":false}')
        return
      }
      if (req.url === KEYS_PATH) {
        res.statusCode = api.keyStatus!
        res.end(api.keyStatus === 200 ? JSON.stringify(api.keys) : '{"success":false}')
        return
      }
      var token = JSON.parse(body || '{}').token
      res.statusCode = api.tokenStatus || (api.validTokens!.has(token) ? 200 : 403)
      res.end(res.statusCode === 200 ? '{"label":"node-1"}' : '{"success":false}')
    })
  })
  return Object.assign(api, running) as FakeApi
}

describe('zebrunner: node keys and tokens of the server units', function() {
  var server = zmqcurve.generateKeyPair()
  var legacy = zmqcurve.generateKeyPair()
  var enrolled = zmqcurve.generateKeyPair()
  var revoked = zmqcurve.generateKeyPair()
  var api: FakeApi

  beforeEach(async function() {
    api = await fakeApi()
  })

  afterEach(async function() {
    await api.close()
  })

  describe('allowed keys', function() {
    var clients = new Set([legacy.publicKey, revoked.publicKey])

    it('should allow the keys of the variables and of the active nodes', function() {
      var nodes = {allowed: new Set([enrolled.publicKey]), denied: new Set<string>()}
      expect(zmqcurve.isAllowedKey(legacy.publicKey, clients, nodes)).to.equal(true)
      expect(zmqcurve.isAllowedKey(enrolled.publicKey, clients, nodes)).to.equal(true)
      expect(zmqcurve.isAllowedKey(server.publicKey, clients, nodes)).to.equal(false)
    })

    it('should refuse the keys of the revoked nodes, even in a variable: deny wins', function() {
      var nodes = {
        allowed: new Set([enrolled.publicKey, revoked.publicKey])
      , denied: new Set([revoked.publicKey])
      }
      expect(zmqcurve.isAllowedKey(revoked.publicKey, clients, nodes)).to.equal(false)
      expect(zmqcurve.isAllowedKey(enrolled.publicKey, clients, nodes)).to.equal(true)
      expect(zmqcurve.isAllowedKey(legacy.publicKey, clients, nodes)).to.equal(true)
    })

    it('should read the API unit of STF_NODES_API_URL with STF_STORAGE_TOKEN', function() {
      var env = {
        STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
      , STF_ZMQ_CURVE_CLIENT_KEYS: legacy.publicKey
      }
      expect(zmqcurve.config(env).server!.nodes).to.equal(null)
      expect(zmqcurve.config(Object.assign({}, env, {
        STF_NODES_API_URL: 'http://stf-api:3000/'
      , STF_STORAGE_TOKEN: INTERNAL
      })).server!.nodes).to.eql({url: 'http://stf-api:3000', token: INTERNAL})
      // without the token of the server units the nodes are ignored
      expect(zmqcurve.config(Object.assign({}, env, {
        STF_NODES_API_URL: 'http://stf-api:3000'
      })).server!.nodes).to.equal(null)
      // the enrolled nodes only, without the legacy variables
      expect(zmqcurve.config({
        STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
      , STF_NODES_API_URL: 'http://stf-api:3000'
      , STF_STORAGE_TOKEN: INTERNAL
      }).server!.clients.size).to.equal(0)
      expect(function() {
        zmqcurve.config(Object.assign({}, env, {
          STF_NODES_API_URL: 'file:///etc/passwd'
        , STF_STORAGE_TOKEN: INTERNAL
        }))
      }).to.throw(/http\(s\) URL/)
    })
  })

  describe('watchNodeKeys', function() {
    it('should read the keys now and again, and keep the last ones on errors', async function() {
      var reads: NodeKeys[] = []
      api.keys = {allowed: [enrolled.publicKey.toUpperCase()], denied: [revoked.publicKey]}
      var watcher = nodesClient.watchNodeKeys(
        {url: api.origin, token: INTERNAL, interval: 30}
      , function(keys) {
          reads.push(keys)
        }
      )
      try {
        await delay(20)
        expect(reads).to.eql([{allowed: [enrolled.publicKey], denied: [revoked.publicKey]}])
        expect(api.requests[0]).to.include({path: '/api/v1/zebrunner/nodes/keys', token: INTERNAL})

        api.keyStatus = 500
        await delay(100)
        api.keyStatus = 200
        api.keys = {allowed: ['not a key'], denied: []}
        await watcher.poll()
        expect(reads).to.have.length(1)

        api.keys = {allowed: [], denied: [enrolled.publicKey]}
        await watcher.poll()
        expect(reads[reads.length - 1]).to.eql({allowed: [], denied: [enrolled.publicKey]})
      }
      finally {
        watcher.stop()
      }
      var count = api.requests.length
      await delay(80)
      expect(api.requests.length).to.equal(count)
    })

    it('should refresh within 10 s', function() {
      expect(KEYS_INTERVAL).to.be.at.most(10000)
      expect(TOKEN_TTL).to.be.at.most(60000)
    })
  })

  describe('ZAP handler', function() {
    this.timeout(10000)

    var sockets: Array<ReturnType<typeof zmq.socket>> = []

    function socket(type: Parameters<typeof zmq.socket>[0], curve: CurveConfig) {
      var sock = zmqcurve.secure(zmq.socket(type), curve)
      sock.setsockopt(zmq.options.linger, 0)
      sockets.push(sock)
      return sock
    }

    function client(keys: {secretKey: string}) {
      return zmqcurve.config({
        STF_ZMQ_CURVE_SERVER_PUBLIC_KEY: server.publicKey
      , STF_ZMQ_CURVE_SECRET_KEY: keys.secretKey
      })
    }

    afterEach(async function() {
      sockets.forEach(function(sock) {
        sock.close()
      })
      sockets = []
      await zmqcurve.stopZapHandler()
    })

    it('should let in the active nodes and keep the revoked ones out', async function() {
      api.keys = {allowed: [enrolled.publicKey], denied: [revoked.publicKey]}
      var endpoint = `tcp://127.0.0.1:${await freePort()}`
      var received: string[] = []
      var pull = socket('pull', zmqcurve.config({
        STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
      , STF_ZMQ_CURVE_CLIENT_KEYS: [legacy.publicKey, revoked.publicKey].join(',')
      , STF_NODES_API_URL: api.origin
      , STF_STORAGE_TOKEN: INTERNAL
      }))
      pull.on('message', function(message: Buffer) {
        received.push(message.toString())
      })
      pull.bindSync(endpoint)
      // the first read of the keys
      await delay(300)

      socket('push', client(legacy)).connect(endpoint).send('legacy')
      socket('push', client(enrolled)).connect(endpoint).send('enrolled')
      socket('push', client(revoked)).connect(endpoint).send('revoked')
      await delay(1000)
      expect(received.sort()).to.deep.equal(['enrolled', 'legacy'])

      // revoked meanwhile: a new connection of its key is refused
      zmqcurve.setNodeKeys({allowed: [], denied: [enrolled.publicKey]})
      socket('push', client(enrolled)).connect(endpoint).send('enrolled again')
      await delay(1000)
      expect(received.sort()).to.deep.equal(['enrolled', 'legacy'])
    })
  })

  describe('storage', function() {
    describe('createTokenVerifier', function() {
      it('should check a node token with the API unit and trust it for a while', async function() {
        api.validTokens.add(TOKEN)
        var verify = nodesClient.createTokenVerifier({url: api.origin, token: INTERNAL})
        expect(await Promise.all([verify(TOKEN), verify(TOKEN)])).to.eql([true, true])
        expect(await verify(TOKEN)).to.equal(true)
        expect(api.requests).to.have.length(1)
        expect(api.requests[0]).to.include({path: '/api/v1/zebrunner/nodes/token', token: INTERNAL})
        expect(JSON.parse(api.requests[0]!.body)).to.eql({token: TOKEN})
      })

      it('should refuse other tokens, asking only for node tokens', async function() {
        var verify = nodesClient.createTokenVerifier({url: api.origin, token: INTERNAL})
        var other = zebrunnerNodes.generateNodeToken('node-2')
        expect(await verify(other)).to.equal(false)
        expect(await verify(other)).to.equal(false)
        expect(api.requests).to.have.length(1)
        expect(await verify('legacy-token')).to.equal(false)
        expect(await verify(null)).to.equal(false)
        expect(api.requests).to.have.length(1)
      })

      it('should refuse a token while the API unit fails, and ask again', async function() {
        api.tokenStatus = 500
        var verify = nodesClient.createTokenVerifier({url: api.origin, token: INTERNAL})
        expect(await verify(TOKEN)).to.equal(false)
        api.tokenStatus = 0
        api.validTokens.add(TOKEN)
        expect(await verify(TOKEN)).to.equal(true)
        expect(api.requests).to.have.length(2)
        var down = nodesClient.createTokenVerifier({url: 'http://127.0.0.1:1', token: INTERNAL})
        expect(await down(TOKEN)).to.equal(false)
      })
    })

    describe('middleware', function() {
      var SECRET = 'storage-secret'
      var STORAGE = 'storage-token'
      var storage: Running
       , checked: string[]

      beforeEach(async function() {
        checked = []
        var app = express()
        app.use(storageauth.middleware({
          secret: SECRET
        , storageToken: STORAGE
        , verifyNodeToken: function(token) {
            checked.push(token)
            return Promise.resolve(token === TOKEN)
          }
        }))
        app.get('/s/blob/:id/:name', function(req, res) {
          res.send('blob')
        })
        storage = await listen(app)
      })

      afterEach(async function() {
        await storage.close()
      })

      function get(token?: string) {
        return fetch(storage.origin + '/s/blob/a/b', {
          headers: token ? {'x-stf-internal-token': token} : {}
        }).then(function(res) {
          return res.status
        })
      }

      it('should let in the units of an active node with its token', async function() {
        expect(await get(TOKEN)).to.equal(200)
        expect(checked).to.eql([TOKEN])
      })

      it('should refuse the token of a node that is not active', async function() {
        expect(await get(zebrunnerNodes.generateNodeToken('node-2'))).to.equal(401)
      })

      it('should still let in the server units with STF_STORAGE_TOKEN', async function() {
        expect(await get(STORAGE)).to.equal(200)
        expect(await get('wrong')).to.equal(401)
        expect(await get()).to.equal(401)
        expect(checked).to.eql([])
      })
    })
  })
})
