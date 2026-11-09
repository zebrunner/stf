// Fork (Zebrunner): the identifiers, secrets and proofs of the enrolled nodes
// (lib/util/zebrunner-nodes.ts) and the node binding of the processor
// (lib/units/processor/zebrunner-nodes.ts)
import {expect} from 'chai'

import zebrunnerNodes from '../../../lib/util/zebrunner-nodes.js'
import processorNodes, {type Registration} from '../../../lib/units/processor/zebrunner-nodes.js'
import type {NodeDocument} from '../../../lib/db/zebrunner-nodes.js'

var TOKEN = zebrunnerNodes.generateNodeToken('node-1')

function node(fields: Partial<NodeDocument> = {}): NodeDocument {
  return Object.assign({
    label: 'node-1'
  , address: '10.0.0.5'
  , publicKey: 'a'.repeat(64)
  , tokenHash: zebrunnerNodes.sha256(TOKEN)
  , status: 'active'
  , createdAt: new Date()
  , revokedAt: null
  , lastSeenAt: null
  , generation: 2
  }, fields) as NodeDocument
}

function registration(fields: Partial<Registration> = {}, token = TOKEN): Registration {
  var base = {
    serial: 'serial1'
  , screenPort: 7404
  , connectPort: 7405
  , providerHost: '10.0.0.5'
  }
  var binding = zebrunnerNodes.deviceBinding(token, base)
  return Object.assign({}, base, {node: binding.node, nodeProof: binding.nodeProof}, fields)
}

describe('zebrunner: nodes', function() {
  describe('labels, tokens and invites', function() {
    it('should accept the labels of the contract only', function() {
      ['a', 'node-1', '0', 'a'.repeat(40), 'mac-mini-2'].forEach(function(label) {
        expect(zebrunnerNodes.isLabel(label), label).to.equal(true)
      })
      var invalid = ['', '-a', 'A', 'node_1', 'node.1', 'a'.repeat(41), ' a', 'a ', 5, null]
      invalid.forEach(function(label) {
        expect(zebrunnerNodes.isLabel(label), String(label)).to.equal(false)
      })
    })

    it('should not take the labels of the static paths of /nodes', function() {
      ['enroll', 'invites', 'relay', 'verify'].forEach(function(label) {
        expect(zebrunnerNodes.isLabel(label), label).to.equal(false)
      })
    })

    it('should make node tokens and invites of 32 random bytes', function() {
      expect(TOKEN).to.match(/^mcn1\.node-1\.[A-Za-z0-9_-]{43}$/)
      expect(zebrunnerNodes.generateNodeToken('node-1')).to.not.equal(TOKEN)
      var invite = zebrunnerNodes.generateInvite()
      expect(invite).to.match(/^mci1\.[A-Za-z0-9_-]{43}$/)
      expect(zebrunnerNodes.isInvite(invite)).to.equal(true)
      expect(zebrunnerNodes.isInvite(invite + 'x')).to.equal(false)
      expect(zebrunnerNodes.isInvite(TOKEN)).to.equal(false)
    })

    it('should read the label of a node token only', function() {
      expect(zebrunnerNodes.tokenLabel(TOKEN)).to.equal('node-1')
      ;[
        'mcn1.node-1.short'
      , TOKEN + 'x'
      , TOKEN.replace('mcn1', 'mcn2')
      , TOKEN.replace('node-1', 'Node-1')
      , 'legacy-shared-token'
      , null
      ].forEach(function(token) {
        expect(zebrunnerNodes.tokenLabel(token), String(token)).to.equal(null)
      })
    })

    it('should compare secrets through their hashes', function() {
      expect(zebrunnerNodes.sha256('a')).to.match(/^[0-9a-f]{64}$/)
      expect(zebrunnerNodes.sameSecret('secret', 'secret')).to.equal(true)
      expect(zebrunnerNodes.sameSecret('secret', 'secreT')).to.equal(false)
      expect(zebrunnerNodes.sameSecret('secret', 'secret-longer')).to.equal(false)
      expect(zebrunnerNodes.sameSecret('', '')).to.equal(false)
      expect(zebrunnerNodes.sameSecret('', 'secret')).to.equal(false)
      expect(zebrunnerNodes.sameSecret(['secret'], 'secret')).to.equal(false)
      expect(zebrunnerNodes.sameHash('a'.repeat(64), 'a'.repeat(64))).to.equal(true)
      expect(zebrunnerNodes.sameHash('a'.repeat(64), 'b'.repeat(64))).to.equal(false)
      expect(zebrunnerNodes.sameHash('a', 'a')).to.equal(false)
    })
  })

  describe('addresses', function() {
    it('should accept IPv4 addresses and host names, in lower case', function() {
      expect(zebrunnerNodes.normalizeAddress('10.0.0.5')).to.equal('10.0.0.5')
      expect(zebrunnerNodes.normalizeAddress('192.168.1.255')).to.equal('192.168.1.255')
      expect(zebrunnerNodes.normalizeAddress('Mac-Mini-1.LAN')).to.equal('mac-mini-1.lan')
      expect(zebrunnerNodes.normalizeAddress('build-ua')).to.equal('build-ua')
      expect(zebrunnerNodes.normalizeAddress('8.8.8.8')).to.equal('8.8.8.8')
    })

    it('should refuse a scheme, a port, a path, IPv6 and the like', function() {
      [
        'http://10.0.0.5', '10.0.0.5:7400', '10.0.0.5/24', 'host/path', '::1', 'fe80::1', '[::1]'
      , '10.0.0.256', '10.0.0', '1.2.3.4.5', '010.0.0.5', 'host_name', '-host', 'host-', 'a..b'
      , 'host.', ' host', 'host ', '', 'a'.repeat(254), 'a'.repeat(64) + '.lan', 'user@host'
      , '1.2.3', null, 5
      ].forEach(function(value) {
        expect(zebrunnerNodes.normalizeAddress(value), String(value)).to.equal(null)
      })
    })

    it('should refuse loopback, link-local, metadata, 0.0.0.0, multicast, broadcast', function() {
      [
        '127.0.0.1', '127.1.2.3', '0.0.0.0', '0.1.2.3', '169.254.169.254', '169.254.0.1'
      , '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', 'localhost', 'LOCALHOST'
      , 'a.localhost'
      , 'metadata', 'metadata.google.internal', 'instance-data.ec2.internal'
      ].forEach(function(value) {
        expect(zebrunnerNodes.normalizeAddress(value), value).to.equal(null)
      })
      expect(zebrunnerNodes.normalizeAddress('169.253.0.1')).to.equal('169.253.0.1')
    })

    it('should accept loopback for stf node-add only', function() {
      var loopback = {loopback: true}
      expect(zebrunnerNodes.normalizeAddress('127.0.0.1', loopback)).to.equal('127.0.0.1')
      expect(zebrunnerNodes.normalizeAddress('LocalHost', loopback)).to.equal('localhost')
      expect(zebrunnerNodes.normalizeAddress('0.0.0.0', loopback)).to.equal(null)
      expect(zebrunnerNodes.normalizeAddress('169.254.169.254', loopback)).to.equal(null)
      expect(zebrunnerNodes.normalizeAddress('metadata', loopback)).to.equal(null)
      expect(zebrunnerNodes.normalizeAddress('223.255.255.255')).to.equal('223.255.255.255')
    })
  })

  describe('node proof', function() {
    var fields = {serial: 'serial1', providerHost: '10.0.0.5', screenPort: 7404, connectPort: 7405}

    it('should be the HMAC-SHA256 of the fields keyed with the token hash', async function() {
      var crypto = await import('node:crypto')
      var key = crypto.createHash('sha256').update(TOKEN).digest()
      var expected = crypto.createHmac('sha256', key)
        .update('v1|serial1|10.0.0.5|7404|7405')
        .digest('hex')
      expect(zebrunnerNodes.proofMessage(fields)).to.equal('v1|serial1|10.0.0.5|7404|7405')
      expect(zebrunnerNodes.nodeProof(TOKEN, fields)).to.equal(expected)
    })

    it('should be verified with the token hash of the server', function() {
      var hash = zebrunnerNodes.sha256(TOKEN)
      var proof = zebrunnerNodes.nodeProof(TOKEN, fields)
      expect(zebrunnerNodes.verifyNodeProof(hash, proof, fields)).to.equal(true)
      expect(zebrunnerNodes.verifyNodeProof(hash, proof.toUpperCase(), fields)).to.equal(false)
      function changed(fields2: object) {
        return Object.assign({}, fields, fields2)
      }
      var verify = zebrunnerNodes.verifyNodeProof
      expect(verify(hash, proof, changed({screenPort: 7408}))).to.equal(false)
      expect(verify(hash, proof, changed({serial: 'other'}))).to.equal(false)
      expect(zebrunnerNodes.verifyNodeProof(hash, proof, Object.assign({}, fields, {
        providerHost: '10.0.0.6'
      }))).to.equal(false)
      var other = zebrunnerNodes.sha256(zebrunnerNodes.generateNodeToken('node-1'))
      expect(zebrunnerNodes.verifyNodeProof(other, proof, fields)).to.equal(false)
      expect(zebrunnerNodes.verifyNodeProof(hash, null, fields)).to.equal(false)
      expect(zebrunnerNodes.verifyNodeProof(hash, 'x', fields)).to.equal(false)
    })

    it('should be sent by a device unit with a node token and its host only', function() {
      expect(zebrunnerNodes.deviceBinding(TOKEN, fields)).to.eql({
        node: 'node-1'
      , nodeProof: zebrunnerNodes.nodeProof(TOKEN, fields)
      , providerHost: '10.0.0.5'
      })
      var none = zebrunnerNodes.deviceBinding(null, fields)
      expect([none.node, none.nodeProof, none.providerHost]).to.eql([null, null, '10.0.0.5'])
      expect(none.warning).to.match(/STF_NODE_TOKEN is not set/)
      var other = zebrunnerNodes.deviceBinding('shared-secret', fields)
      expect([other.node, other.nodeProof]).to.eql([null, null])
      expect(other.warning).to.match(/not a node token/)
      expect(other.warning).to.not.include('shared-secret')
      var hostless = zebrunnerNodes.deviceBinding(TOKEN, Object.assign({}, fields, {
        providerHost: ''
      }))
      expect([hostless.node, hostless.nodeProof]).to.eql([null, null])
    })
  })

  describe('screen URIs', function() {
    it('should read the host, serial and port of /d/<host>/<serial>/<port>/', function() {
      expect(zebrunnerNodes.parseScreenUri('/d/10.0.0.5/emulator-5554/7404/'))
        .to.eql({host: '10.0.0.5', serial: 'emulator-5554', port: 7404})
      expect(zebrunnerNodes.parseScreenUri('/d/Node-1.LAN/192.168.1.5%3A5555/7404/?x=1'))
        .to.eql({host: 'node-1.lan', serial: '192.168.1.5:5555', port: 7404})
    })

    it('should refuse anything else', function() {
      [
        '/d/host/serial/7404', '/d/host/serial/port/', '/d/host/serial/7404/more', '/x/host/s/1/'
      , '/d//serial/7404/', '/d/host/serial/0/', '/d/host/serial/70000/', '/d/h%2Fx/s/1/'
      , '/d/%E0%A4%A/s/1/', '', null, ['/d/host/serial/7404/']
      ].forEach(function(uri) {
        expect(zebrunnerNodes.parseScreenUri(uri), String(uri)).to.equal(null)
      })
    })
  })

  describe('processor binding', function() {
    it('should bind a device proved by the active node at its address', function() {
      expect(processorNodes.decide(registration(), node())).to.eql({
        result: 'bound', binding: {node: 'node-1', nodeGeneration: 2}
      })
      expect(processorNodes.decide(registration({providerHost: 'NODE-1.lan'}), node({
        address: 'node-1.lan'
      })).result).to.equal('rejected')
    })

    var refusals: Array<[string, Registration, NodeDocument | null, RegExp]> = [
      ['no proof', registration({node: null, nodeProof: null}), null, /^no node proof/]
    , ['an unknown node', registration(), null, /^unknown node$/]
    , ['a revoked node', registration(), node({status: 'revoked'}), /^revoked node$/]
    , ['another host', registration({providerHost: '10.0.0.6'}), node()
      , /^the host of the provider/]
    , ['another token', registration({}, zebrunnerNodes.generateNodeToken('node-1')), node()
      , /^invalid node proof/]
    , ['other ports', registration({screenPort: 7408}), node(), /^invalid node proof/]
    , ['another label', registration({node: 'node-2'}), node(), /^unknown node$/]
    ]

    refusals.forEach(function([what, reg, labelNode, reason]) {
      it(`should reject ${what}, from any host`, function() {
        var decision = processorNodes.decide(reg, labelNode)
        expect(decision.result).to.equal('rejected')
        expect((decision as {reason: string}).reason).to.match(reason)
      })
    })

    it('should keep the node a registration claims, a label only', function() {
      expect(processorNodes.claimOf({node: 'node-1'})).to.equal('node-1')
      expect(processorNodes.claimOf({node: 'Not A Label'})).to.equal(null)
      expect(processorNodes.claimOf({node: null})).to.equal(null)
      expect(processorNodes.claimOf({})).to.equal(null)
    })

    describe('binder', function() {
      var warnings: string[]
       , nodes: Record<string, NodeDocument>
       , devices: Record<string, {node?: string | null, nodeGeneration?: number | null}>
       , broken: boolean
      var db = {
        loadNode: function(label: string) {
          if (broken) {
            return Promise.reject(new Error('database down'))
          }
          return Promise.resolve(nodes[label] || null)
        }
      , loadDeviceBySerial: function(serial: string) {
          return Promise.resolve(devices[serial] || null)
        }
      }
      var log = {
        warn: function(...args: unknown[]) {
          warnings.push(args.map(String).join(' '))
        }
      , error: function(...args: unknown[]) {
          warnings.push(args.map(String).join(' '))
        }
      }

      beforeEach(function() {
        warnings = []
        broken = false
        nodes = {'node-1': node()}
        devices = {}
      })

      it('should make ready only a device bound to an active node', async function() {
        var binder = processorNodes.createNodeBinder(db, log, {bindingWait: 50, bindingPoll: 10})
        var ready: string[] = []
        var handler = binder.whenAccepted(function(channel, message: {serial: string}) {
          ready.push(message.serial)
        })

        // the ready message comes while the check of the registration runs
        var forged = binder.bind(registration({serial: 'forged', nodeProof: 'f'.repeat(64)}))
        handler('channel', {serial: 'forged'}, Buffer.alloc(0))
        var good = binder.bind(registration())
        handler('channel', {serial: 'serial1'}, Buffer.alloc(0))
        // a device without a registration of its node
        handler('channel', {serial: 'unknown'}, Buffer.alloc(0))
        expect((await forged).result).to.equal('rejected')
        expect((await good).result).to.equal('bound')
        await new Promise(function(resolve) {
          setTimeout(resolve, 10)
        })
        expect(ready.sort()).to.eql(['serial1'])
        expect(warnings[0])
          .to.match(/^Rejected the registration of device "%s".* forged 10\.0\.0\.5 node-1 /)
        expect(warnings.join('\n')).to.not.include(TOKEN)

        // a later valid registration of the device makes it ready
        var proved = Object.assign(registration(), {serial: 'forged'})
        proved.nodeProof = zebrunnerNodes.nodeProof(TOKEN, {
          serial: 'forged', providerHost: '10.0.0.5', screenPort: 7404, connectPort: 7405
        })
        expect((await binder.bind(proved)).result).to.equal('bound')
        expect(await binder.accepted('forged')).to.equal(true)
      })

      it('should check in the database a device it did not register', async function() {
        var binder = processorNodes.createNodeBinder(db, log, {bindingWait: 50, bindingPoll: 10})
        devices = {
          bound: {node: 'node-1', nodeGeneration: 2}
        , rotated: {node: 'node-1', nodeGeneration: 1}
        , unbound: {node: null}
        }
        expect(await binder.accepted('bound')).to.equal(true)
        expect(await binder.accepted('rotated')).to.equal(false)
        expect(await binder.accepted('unbound')).to.equal(false)
        expect(await binder.accepted('missing')).to.equal(false)
        nodes = {'node-1': node({status: 'revoked'})}
        expect(await binder.accepted('bound')).to.equal(false)
      })

      // stf local runs two processors: the registration and the ready message of a device can go to
      // different ones
      it('should wait for the binding another processor writes', async function() {
        var binder = processorNodes.createNodeBinder(db, log, {bindingWait: 1000, bindingPoll: 10})
        setTimeout(function() {
          devices.late = {node: 'node-1', nodeGeneration: 2}
        }, 100)
        var started = Date.now()
        expect(await binder.accepted('late')).to.equal(true)
        expect(Date.now() - started).to.be.within(80, 900)
      })

      it('should reject a registration when the database fails', async function() {
        var binder = processorNodes.createNodeBinder(db, log, {bindingWait: 50, bindingPoll: 10})
        broken = true
        var decision = await binder.bind(registration())
        expect(decision.result).to.equal('rejected')
        expect(await binder.accepted('serial1')).to.equal(false)
      })
    })
  })
})
