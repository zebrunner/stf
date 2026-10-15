// Fork (Zebrunner): SSRF protection of the downloads of the storage units, lib/util/urlsafety.ts
import fs from 'node:fs/promises'
import type http from 'node:http'

import {expect} from 'chai'

import requtil from '../../../lib/util/requtil.js'
import urlsafety from '../../../lib/util/urlsafety.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

type Lookup = (
  hostname: string
, options: object
, callback: (err: Error | null, address: unknown, family?: number) => void
) => void

function rejection(promise: PromiseLike<unknown>): Promise<Error & {errors?: unknown}> {
  return Promise.resolve(promise).then(
    function() {
      throw new Error('expected a rejection')
    }
  , function(err: Error) {
      return err
    }
  )
}

function redirect(location: string, from = 'http://8.8.8.8/start'): unknown {
  return {
    headers: {location: location}
  , request: {uri: new URL(from)}
  }
}

describe('zebrunner: urlsafety', function() {
  describe('isRestricted', function() {
    var restricted = [
      '0.0.0.0'
    , '10.1.2.3'
    , '100.64.0.1'
    , '127.0.0.1'
    , '127.255.255.254'
    , '169.254.169.254'
    , '172.16.0.1'
    , '172.31.255.255'
    , '192.168.1.1'
    , '198.18.0.1'
    , '224.0.0.1'
    , '255.255.255.255'
    , '::'
    , '::1'
    , '::ffff:127.0.0.1'
    , '::ffff:7f00:1'
    , '::ffff:a9fe:a9fe'
    , '64:ff9b::7f00:1'
    , '2002:7f00:1::1'
    , 'fc00::1'
    , 'fd12:3456::1'
    , 'fe80::1'
    , 'ff02::1'
    , 'not an address'
    ]
    var unrestricted = [
      '8.8.8.8'
    , '1.1.1.1'
    , '172.32.0.1'
    , '2606:4700:4700::1111'
    , '::ffff:8.8.8.8'
    ]

    restricted.forEach(function(address) {
      it('should restrict ' + address, function() {
        expect(urlsafety.isRestricted(address)).to.equal(true)
      })
    })

    unrestricted.forEach(function(address) {
      it('should not restrict ' + address, function() {
        expect(urlsafety.isRestricted(address)).to.equal(false)
      })
    })

    it('should let the networks of the allow list through only', function() {
      var allowList = urlsafety.createAllowList(['10.1.2.0/24', '192.168.7.7', 'fd00::/8'])
      expect(urlsafety.isRestricted('10.1.2.200', allowList)).to.equal(false)
      expect(urlsafety.isRestricted('10.1.3.1', allowList)).to.equal(true)
      expect(urlsafety.isRestricted('192.168.7.7', allowList)).to.equal(false)
      expect(urlsafety.isRestricted('192.168.7.8', allowList)).to.equal(true)
      expect(urlsafety.isRestricted('fd12::1', allowList)).to.equal(false)
      expect(urlsafety.isRestricted('127.0.0.1', allowList)).to.equal(true)
    })

    it('should refuse an invalid network of the allow list', function() {
      expect(function() {
        urlsafety.createAllowList(['intranet'])
      }).to.throw(/Invalid network "intranet"/)
    })
  })

  describe('assertSafeUrl', function() {
    var refused: Array<[string, RegExp]> = [
      ['not a url', /Invalid URL/]
    , ['file:///etc/passwd', /Only http and https/]
    , ['ftp://8.8.8.8/file', /Only http and https/]
    , ['gopher://8.8.8.8/', /Only http and https/]
    , ['http://127.0.0.1/', /restricted address/]
    , ['http://localhost:7100/s/blob/x/y', /restricted address/]
    , ['http://[::1]/', /restricted address/]
    , ['http://[::ffff:127.0.0.1]/', /restricted address/]
    , ['http://0x7f000001/', /restricted address/]
    , ['http://2130706433/', /restricted address/]
    , ['http://127.1/', /restricted address/]
    , ['http://169.254.169.254/latest/meta-data/', /restricted address/]
    , ['https://10.0.0.1/app.apk', /restricted address/]
    , ['http://host.invalid/app.apk', /Unable to resolve host/]
    ]

    refused.forEach(function([url, message]) {
      it('should refuse ' + url + ' with a validation error', async function() {
        var err = await rejection(urlsafety.assertSafeUrl(url))
        expect(err).to.be.instanceOf(requtil.ValidationError)
        expect(JSON.stringify(err.errors)).to.match(message)
      })
    })

    it('should accept a public address', async function() {
      expect(await urlsafety.assertSafeUrl('https://8.8.8.8/app.apk')).to.eql(['8.8.8.8'])
    })

    it('should accept a private address of the allow list', async function() {
      var allowList = urlsafety.createAllowList(['127.0.0.0/8', '::1'])
      var addresses = await urlsafety.assertSafeUrl('http://localhost/app.apk', allowList)
      expect(addresses).to.include('127.0.0.1')
    })
  })

  describe('requestOptions', function() {
    var options = urlsafety.requestOptions()
    var follow = options.followRedirect as (response: unknown) => boolean
    var lookup = options.lookup as Lookup
    var allowed = urlsafety.requestOptions(urlsafety.createAllowList(['127.0.0.0/8', '::1']))
    var allowedLookup = allowed.lookup as Lookup

    it('should limit the redirects', function() {
      expect(options.maxRedirects).to.equal(5)
    })

    it('should follow a redirect to a public or a named host', function() {
      expect(follow(redirect('https://example.com/app.apk'))).to.equal(true)
      expect(follow(redirect('/app.apk'))).to.equal(true)
      expect(follow({headers: {}, request: {uri: new URL('http://8.8.8.8/')}})).to.equal(true)
    })

    it('should not follow a redirect to a restricted address', function() {
      expect(follow(redirect('http://169.254.169.254/latest/meta-data/'))).to.equal(false)
      expect(follow(redirect('http://[::1]:7100/s/blob/a/b'))).to.equal(false)
      expect(follow(redirect('/s/blob/a/b', 'http://127.0.0.1/'))).to.equal(false)
    })

    it('should not follow a redirect to another scheme or a broken location', function() {
      expect(follow(redirect('file:///etc/passwd'))).to.equal(false)
      expect(follow(redirect('http://[broken'))).to.equal(false)
    })

    it('should not connect to a host that resolves to a restricted address', function(done) {
      lookup('localhost', {}, function(err) {
        expect(err).to.be.instanceOf(Error)
        expect(err!.message).to.match(/restricted address of "localhost"/)
        done()
      })
    })

    it('should connect to a restricted address of the allow list', function(done) {
      allowedLookup('localhost', {}, function(err, address) {
        expect(err).to.equal(null)
        expect(['127.0.0.1', '::1']).to.include(address)
        done()
      })
    })

    it('should give every address back when all of them are asked for', function(done) {
      allowedLookup('localhost', {all: true}, function(err, addresses) {
        expect(err).to.equal(null)
        expect(addresses).to.be.an('array').that.is.not.empty
        done()
      })
    })
  })

  describe('download', function() {
    var target: Running, internal: Running
    var hits: string[] = []

    before(async function() {
      internal = await listen(function(req, res) {
        hits.push('internal ' + req.url)
        res.end('secret')
      }, '::1')
      var internalPort = new URL(internal.origin).port
      target = await listen(function(req: http.IncomingMessage, res: http.ServerResponse) {
        hits.push('target ' + req.url)
        switch (req.url) {
        case '/app.apk':
          res.end('apk content')
          break
        case '/to-literal':
          res.writeHead(302, {location: 'http://[::1]:' + internalPort + '/meta'})
          res.end()
          break
        case '/to-hostname':
          res.writeHead(302, {location: 'http://localhost:' + internalPort + '/meta'})
          res.end()
          break
        default:
          res.writeHead(404)
          res.end()
        }
      })
    })

    after(async function() {
      await target.close()
      await internal.close()
    })

    beforeEach(function() {
      hits.length = 0
    })

    it('should refuse a restricted URL without requesting it', async function() {
      var err = await rejection(urlsafety.download(target.origin + '/app.apk', {}))
      expect(err).to.be.instanceOf(requtil.ValidationError)
      expect(hits).to.eql([])
    })

    it('should download from a network of the allow list', async function() {
      var file = await urlsafety.download(target.origin + '/app.apk', {}, ['127.0.0.1'])
      try {
        expect(await fs.readFile(file.path, 'utf8')).to.equal('apk content')
      }
      finally {
        await fs.rm(file.path, {force: true})
      }
    })

    it('should not follow a redirect to a restricted literal address', async function() {
      var file = await urlsafety.download(target.origin + '/to-literal', {}, ['127.0.0.1'])
      await fs.rm(file.path, {force: true})
      expect(hits).to.eql(['target /to-literal'])
    })

    it('should not connect to a redirect host that resolves to a restricted address',
      async function() {
        var err = await rejection(
          urlsafety.download(target.origin + '/to-hostname', {}, ['127.0.0.1'])
        )
        expect(err).to.be.instanceOf(Error)
        expect(hits).to.eql(['target /to-hostname'])
      })
  })
})
