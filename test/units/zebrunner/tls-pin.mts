// Fork (Zebrunner): the pin of the TLS key of MCloud for the requests of the device units to the
// storage with the token of the node: lib/util/tlspin.ts and lib/util/storageauth.ts
import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import https from 'node:https'
import type net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import request from '@cypress/request'
import {expect} from 'chai'

import storageauth from '../../../lib/util/storageauth.js'
import tlspin from '../../../lib/util/tlspin.js'

var TOKEN = 'mcn1.node.' + 'A'.repeat(43)

// a self-signed certificate of localhost made by openssl, its key and its pin
function selfSigned(dir: string) {
  var key = path.join(dir, 'key.pem')
  var cert = path.join(dir, 'cert.pem')
  var config = path.join(dir, 'openssl.cnf')
  fs.writeFileSync(config, [
    '[req]', 'distinguished_name = dn', 'x509_extensions = ext', 'prompt = no', '[dn]'
  , 'CN = localhost', '[ext]', 'subjectAltName = DNS:localhost'
  ].join('\n') + '\n')
  childProcess.execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', config, '-keyout', key
  , '-out', cert, '-days', '2'
  ], {stdio: 'ignore'})
  var pem = fs.readFileSync(cert, 'utf8')
  var spki = new crypto.X509Certificate(pem).publicKey.export({type: 'spki', format: 'der'})
  return {
    key: fs.readFileSync(key, 'utf8')
  , cert: pem
  , pin: crypto.createHash('sha256').update(spki).digest('base64')
  }
}

function hasOpenssl() {
  try {
    childProcess.execFileSync('openssl', ['version'], {stdio: 'ignore'})
    return true
  }
  catch (err) {
    return false
  }
}

function get(options: request.CoreOptions & {url: string}) {
  return new Promise<{status: number, body: string}>(function(resolve, reject) {
    request(options, function(err, res, body) {
      if (err) {
        reject(err)
        return
      }
      resolve({status: res.statusCode!, body: body as string})
    })
  })
}

describe('zebrunner: the pin of the TLS key of MCloud', function() {
  var saved: {pin?: string, token?: string}

  beforeEach(function() {
    saved = {}
    if ('MCLOUD_TLS_PIN' in process.env) {
      saved.pin = process.env.MCLOUD_TLS_PIN!
    }
    if ('STF_NODE_TOKEN' in process.env) {
      saved.token = process.env.STF_NODE_TOKEN!
    }
    tlspin.reset()
  })

  afterEach(function() {
    for (var [name, key] of [['MCLOUD_TLS_PIN', 'pin'], ['STF_NODE_TOKEN', 'token']] as const) {
      if (key in saved) {
        process.env[name] = saved[key]!
      }
      else {
        delete process.env[name]
      }
    }
    tlspin.reset()
  })

  describe('MCLOUD_TLS_PIN', function() {
    var pin = 'q'.repeat(43) + '='

    it('should be off without a value', function() {
      expect(tlspin.parsePins(null)).to.equal(null)
      expect(tlspin.parsePins('  ')).to.equal(null)
      expect(tlspin.agent({})).to.equal(null)
    })

    it('should take the pins of curl, with or without sha256//', function() {
      expect(tlspin.parsePins(pin)).to.eql([pin])
      expect(tlspin.parsePins('sha256//' + pin + ';' + pin.replace(/^q/, 'r')))
        .to.eql([pin, pin.replace(/^q/, 'r')])
      expect(tlspin.parsePins(pin + ', ' + pin)).to.eql([pin, pin])
    })

    it('should refuse an invalid pin', function() {
      expect(function() {
        tlspin.parsePins('not-a-pin')
      }).to.throw(tlspin.TlsPinError)
    })

    it('should leave the requests to the storage as they are without a pin, a token', function() {
      delete process.env.MCLOUD_TLS_PIN
      delete process.env.STF_NODE_TOKEN
      var options = {url: 'https://mcloud.example.com/s/upload/image'}
      expect(storageauth.sign(options)).to.equal(options)
      expect(storageauth.agentFor(options.url)).to.equal(null)
    })

    it('should pin the https requests to the storage only', function() {
      process.env.MCLOUD_TLS_PIN = pin
      var signed = storageauth.sign({url: 'https://mcloud.example.com/s/upload/image'}) as {
        agent?: unknown
      }
      expect(signed.agent).to.be.an.instanceOf(tlspin.PinnedAgent)
      expect(storageauth.agentFor('http://mcloud.example.com/s/blob/a')).to.equal(null)
      var plain = storageauth.sign({url: 'http://mcloud.example.com/s/upload/image'})
      expect(plain).to.not.have.property('agent')
    })
  })

  describe('requests', function() {
    var dir: string, server: https.Server, port: number, connections: number
      , certificate: ReturnType<typeof selfSigned>, received: Array<string | null>

    before(function(done) {
      if (!hasOpenssl()) {
        this.skip()
      }
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-tlspin-'))
      certificate = selfSigned(dir)
      server = https.createServer({key: certificate.key, cert: certificate.cert}
      , function(req: http.IncomingMessage, res: http.ServerResponse) {
          received.push((req.headers['x-stf-internal-token'] as string) || null)
          res.end('the app')
        })
      server.on('connection', function() {
        connections++
      })
      server.listen(0, '127.0.0.1', function() {
        port = (server.address() as net.AddressInfo).port
        done()
      })
    })

    after(function(done) {
      if (dir) {
        fs.rmSync(dir, {recursive: true, force: true})
      }
      if (server) {
        server.close(function() {
          done()
        })
      }
      else {
        done()
      }
    })

    beforeEach(function() {
      received = []
      connections = 0
      process.env.STF_NODE_TOKEN = TOKEN
    })

    function url() {
      return 'https://localhost:' + port + '/s/blob/a/app.apk'
    }

    it('should compute the pin of curl', function() {
      expect(tlspin.spkiPin(new crypto.X509Certificate(certificate.cert).raw))
        .to.equal(certificate.pin)
    })

    it('should send the token to the server of the pinned key, not of its chain', async function() {
      process.env.MCLOUD_TLS_PIN = certificate.pin
      var answer = await get(storageauth.sign({url: url()}))
      expect(answer).to.eql({status: 200, body: 'the app'})
      expect(received).to.eql([TOKEN])
    })

    it('should send nothing to a server of another key', async function() {
      process.env.MCLOUD_TLS_PIN = 'sha256//' + 'A'.repeat(43) + '='
      var error = await get(storageauth.sign({url: url()})).then(function() {
        return null
      }, function(err: Error) {
        return err
      })
      expect(error).to.be.an.instanceOf(tlspin.TlsPinError)
      expect(connections).to.equal(1)
      expect(received).to.eql([])
    })

    it('should accept any of several pins (the next key of MCloud)', async function() {
      process.env.MCLOUD_TLS_PIN = 'A'.repeat(43) + '=;' + certificate.pin
      expect((await get(storageauth.sign({url: url()}))).status).to.equal(200)
    })

    it('should refuse every request with an invalid pin', async function() {
      process.env.MCLOUD_TLS_PIN = 'not-a-pin'
      var error = await get(storageauth.sign({url: url()})).then(function() {
        return null
      }, function(err: Error) {
        return err
      })
      expect(error).to.be.an.instanceOf(tlspin.TlsPinError)
      expect(connections).to.equal(0)
    })

    it('should pin the downloads with node:https of the iOS units', async function() {
      process.env.MCLOUD_TLS_PIN = 'A'.repeat(43) + '='
      var error = await new Promise<Error | null>(function(resolve) {
        https.get(url(), {
          headers: storageauth.internalHeaders()
        , agent: storageauth.agentFor(url())!
        }
        , function(res) {
            res.resume()
            resolve(null)
          }).on('error', resolve)
      })
      expect(error).to.be.an.instanceOf(tlspin.TlsPinError)
      expect(received).to.eql([])
      tlspin.reset()
      process.env.MCLOUD_TLS_PIN = certificate.pin
      var status = await new Promise<number>(function(resolve, reject) {
        https.get(url(), {
          headers: storageauth.internalHeaders()
        , agent: storageauth.agentFor(url())!
        }
        , function(res) {
            res.resume()
            resolve(res.statusCode!)
          }).on('error', reject)
      })
      expect(status).to.equal(200)
      expect(received).to.eql([TOKEN])
    })

    it('should refuse the self-signed certificate without a pin, as before', async function() {
      delete process.env.MCLOUD_TLS_PIN
      var error = await get(storageauth.sign({url: url()})).then(function() {
        return null
      }, function(err: Error) {
        return err
      })
      expect(error).to.be.an('error')
      expect(received).to.eql([])
    })
  })
})
