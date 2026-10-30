// Fork (Zebrunner): CURVE security of the ZeroMQ sockets, lib/util/zmqcurve.ts
import net from 'net'

import {expect} from 'chai'
import sinon from 'sinon'
import zmq from 'zeromq/v5-compat.js'

import * as curveKeygen from '../../../lib/cli/curve-keygen/index.js'
import logger from '../../../lib/util/logger.js'
import zmqcurve, {type CurveConfig} from '../../../lib/util/zmqcurve.js'

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

function delay(ms: number) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms)
  })
}

function clientConfig(server: {publicKey: string}, client: {secretKey: string}): CurveConfig {
  return zmqcurve.config({
    STF_ZMQ_CURVE_SERVER_PUBLIC_KEY: server.publicKey
  , STF_ZMQ_CURVE_SECRET_KEY: client.secretKey
  })
}

describe('zebrunner: ZeroMQ CURVE', function() {
  var server = zmqcurve.generateKeyPair()
  var allowed = zmqcurve.generateKeyPair()
  var unknown = zmqcurve.generateKeyPair()

  describe('keys', function() {
    it('should encode Z85 as ZMQ RFC 32', function() {
      expect(zmqcurve.z85(Buffer.from('864fd26fb559f75b', 'hex'))).to.equal('HelloWorld')
    })

    it('should generate pairs of 64 hex characters, the public key of the secret one', function() {
      expect(server.publicKey).to.match(/^[0-9a-f]{64}$/)
      expect(server.secretKey).to.match(/^[0-9a-f]{64}$/)
      expect(server.secretKey).not.to.equal(allowed.secretKey)
      expect(zmqcurve.generateKeyPair(server.secretKey)).to.deep.equal(server)
    })

    it('should refuse a secret key that is not 64 hex characters', function() {
      expect(function() {
        zmqcurve.generateKeyPair('xyz')
      }).to.throw(/64 hex characters/)
    })
  })

  describe('config', function() {
    it('should be empty without the variables, the sockets have no security', function() {
      expect(zmqcurve.config({})).to.deep.equal({})
    })

    it('should allow the client keys and the key of the unit itself', function() {
      var curve = zmqcurve.config({
        STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
      , STF_ZMQ_CURVE_SERVER_PUBLIC_KEY: server.publicKey
      , STF_ZMQ_CURVE_SECRET_KEY: unknown.secretKey
      , STF_ZMQ_CURVE_CLIENT_KEYS: ` ${allowed.publicKey.toUpperCase()}, ${server.publicKey} `
      })
      expect([...curve.server!.clients].sort()).to.deep.equal(
        [allowed.publicKey, server.publicKey, unknown.publicKey].sort())
      expect(curve.client!.publicKey.toString('hex')).to.equal(unknown.publicKey)
      expect(curve.client!.serverKey.toString('hex')).to.equal(server.publicKey)
    })

    it('should refuse an incomplete or invalid configuration', function() {
      expect(function() {
        zmqcurve.config({STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey})
      }).to.throw(/needs the keys of the clients/)
      expect(function() {
        zmqcurve.config({STF_ZMQ_CURVE_SERVER_PUBLIC_KEY: server.publicKey})
      }).to.throw(/needs STF_ZMQ_CURVE_SECRET_KEY/)
      expect(function() {
        zmqcurve.config({STF_ZMQ_CURVE_SECRET_KEY: allowed.secretKey})
      }).to.throw(/needs STF_ZMQ_CURVE_SERVER_PUBLIC_KEY/)
      expect(function() {
        zmqcurve.config({
          STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
        , STF_ZMQ_CURVE_CLIENT_KEYS: `${allowed.publicKey},abc`
        })
      }).to.throw(/STF_ZMQ_CURVE_CLIENT_KEYS must be a key/)
    })

    it('should tell a client what to check when the server does not get its messages', function() {
      expect(zmqcurve.clientHint(clientConfig(server, allowed))).to.equal(
        'Check that the ZeroMQ server lets this host in: its CURVE public key ' +
        `${allowed.publicKey} in STF_ZMQ_CURVE_CLIENT_KEYS of the server (restart the server ` +
        'after a change), STF_ZMQ_CURVE_SERVER_PUBLIC_KEY the one of the server, the triproxy ' +
        'endpoints reachable.')
      expect(zmqcurve.clientHint({})).to.equal('Check that the triproxy endpoints are reachable.')
    })
  })

  describe('sockets', function() {
    this.timeout(10000)

    var sockets: Array<ReturnType<typeof zmq.socket>> = []

    // linger 0: the messages of the refused clients would keep the process alive
    function socket(type: Parameters<typeof zmq.socket>[0], curve: CurveConfig) {
      var sock = zmqcurve.secure(zmq.socket(type), curve)
      sock.setsockopt(zmq.options.linger, 0)
      sockets.push(sock)
      return sock
    }

    afterEach(function() {
      sockets.forEach(function(sock) {
        sock.close()
      })
      sockets = []
      zmqcurve.stopZapHandler()
    })

    it('should let in only the clients with an allowed key', async function() {
      var endpoint = `tcp://127.0.0.1:${await freePort()}`
      var received: string[] = []
      var pull = socket('pull', zmqcurve.config({
        STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
      , STF_ZMQ_CURVE_CLIENT_KEYS: allowed.publicKey
      }))
      pull.on('message', function(message: Buffer) {
        received.push(message.toString())
      })
      pull.bindSync(endpoint)

      // connected at once: a client refused before the ZAP handler is up connects again
      socket('push', clientConfig(server, allowed)).connect(endpoint).send('allowed')
      socket('push', clientConfig(server, unknown)).connect(endpoint).send('unknown')
      socket('push', clientConfig(allowed, allowed)).connect(endpoint).send('wrong server key')
      socket('push', {}).connect(endpoint).send('plain')

      await delay(1500)
      expect(received).to.deep.equal(['allowed'])
    })

    it('should secure the endpoints bound asynchronously', async function() {
      var endpoint = `tcp://127.0.0.1:${await freePort()}`
      var pub = socket('pub', zmqcurve.config({
        STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
      , STF_ZMQ_CURVE_CLIENT_KEYS: allowed.publicKey
      }))
      await new Promise<void>(function(resolve, reject) {
        pub.bind(endpoint, function(err?: Error) {
          return err ? reject(err) : resolve()
        })
      })
      var received: Record<string, string[]> = {allowed: [], plain: []}
      Object.keys(received).forEach(function(name) {
        var sub = socket('sub', name === 'allowed' ? clientConfig(server, allowed) : {})
        sub.subscribe('')
        sub.on('message', function(message: Buffer) {
          received[name]!.push(message.toString())
        })
        sub.connect(endpoint)
      })

      await delay(1000)
      pub.send('event')
      await delay(500)
      expect(received).to.deep.equal({allowed: ['event'], plain: []})
    })

    it('should log on the client the refusal of its key, once a minute', async function() {
      var endpoint = `tcp://127.0.0.1:${await freePort()}`
      var warnings: string[] = []
      var onEntry = function(entry: logger.Entry) {
        if (entry.tag === 'util:zmqcurve' && entry.priority === logger.Level.WARNING) {
          warnings.push(entry.message)
        }
      }
      logger.on('entry', onEntry)
      try {
        socket('pull', zmqcurve.config({
          STF_ZMQ_CURVE_SERVER_SECRET_KEY: server.secretKey
        , STF_ZMQ_CURVE_CLIENT_KEYS: allowed.publicKey
        })).bindSync(endpoint)
        // the ZAP handler is up before the clients come
        await delay(200)
        socket('push', clientConfig(server, allowed)).connect(endpoint)
        socket('push', clientConfig(server, unknown)).connect(endpoint)
        await delay(500)
        socket('sub', clientConfig(server, unknown)).connect(endpoint)
        await delay(500)
      }
      finally {
        logger.removeListener('entry', onEntry)
      }

      // the server logs its side too, once a minute for 127.0.0.1 of all the tests
      expect(warnings.filter(function(message) {
        return message.startsWith('The ZeroMQ server')
      })).to.deep.equal([
        `The ZeroMQ server ${endpoint} refused the CURVE key ${unknown.publicKey} of this host: ` +
        'add it to STF_ZMQ_CURVE_CLIENT_KEYS of the server and restart it'
      ])
    })

    it('should leave the sockets as they are without the variables', async function() {
      var endpoint = `tcp://127.0.0.1:${await freePort()}`
      var received: string[] = []
      var pull = socket('pull', {})
      pull.on('message', function(message: Buffer) {
        received.push(message.toString())
      })
      pull.bindSync(endpoint)
      socket('push', {}).connect(endpoint).send('plain')

      await delay(500)
      expect(received).to.deep.equal(['plain'])
    })
  })

  describe('stf curve-keygen', function() {
    type KeygenArgv = Parameters<typeof curveKeygen.handler>[0]
    var write: sinon.SinonStub

    beforeEach(function() {
      write = sinon.stub(process.stdout, 'write').returns(true)
    })

    afterEach(function() {
      write.restore()
    })

    it('should print the pair of a secret key', function() {
      curveKeygen.handler({secretKey: server.secretKey} as KeygenArgv)
      write.restore()
      expect(write.callCount).to.equal(1)
      expect(write.firstCall.args[0])
        .to.equal(`public=${server.publicKey}\nsecret=${server.secretKey}\n`)
    })

    it('should print a new pair', function() {
      curveKeygen.handler({} as KeygenArgv)
      write.restore()
      var output = String(write.firstCall.args[0])
      var secret = /^secret=([0-9a-f]{64})$/m.exec(output)![1]!
      var pair = zmqcurve.generateKeyPair(secret)
      expect(output).to.equal(`public=${pair.publicKey}\nsecret=${secret}\n`)
    })
  })
})
