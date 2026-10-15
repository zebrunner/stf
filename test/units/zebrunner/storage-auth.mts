// Fork (Zebrunner): authentication of the storage routes, lib/util/storageauth.ts and its use by
// the storage units, the storage plugins and the device units
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'
import express from 'express'

import Storage from '../../../lib/util/storage.js'
import storageauth from '../../../lib/util/storageauth.js'
import getImage from '../../../lib/units/storage/plugins/image/task/get.js'
import {mockModule} from '../../helpers/module-mock.mts'
import {listen, sessionCookie, startUnit, type Running} from '../../helpers/zebrunner.mts'

var SECRET = 'storage-test-secret'
var TOKEN = 'storage-test-token'

async function upload(origin: string, headers: Record<string, string> = {}) {
  var form = new FormData()
  form.append('file', new Blob([Buffer.from('apk content')]), 'app.apk')
  return fetch(origin + '/s/upload/apk', {method: 'POST', body: form, headers: headers})
}

describe('zebrunner: storage auth', function() {
  var savedToken: string | undefined

  beforeEach(function() {
    savedToken = process.env.STF_STORAGE_TOKEN
  })

  afterEach(function() {
    if (typeof savedToken === 'undefined') {
      delete process.env.STF_STORAGE_TOKEN
    }
    else {
      process.env.STF_STORAGE_TOKEN = savedToken
    }
  })

  describe('client helpers', function() {
    it('should leave the request options as they are without a token', function() {
      delete process.env.STF_STORAGE_TOKEN
      var options = {url: 'http://storage/s/upload/image'}
      expect(storageauth.sign(options)).to.equal(options)
      expect(storageauth.internalHeaders()).to.eql({})
    })

    it('should add the token to the request options', function() {
      process.env.STF_STORAGE_TOKEN = TOKEN
      expect(storageauth.sign({url: 'u', headers: {accept: 'x'}})).to.eql({
        url: 'u'
      , headers: {accept: 'x', 'x-stf-internal-token': TOKEN}
      })
      expect(storageauth.internalHeaders()).to.eql({'x-stf-internal-token': TOKEN})
    })

    it('should forward only the credentials of the caller', function() {
      var headers = storageauth.forwardHeaders({
        headers: {
          cookie: 'ssid=a; ssid.sig=b'
        , 'x-stf-internal-token': TOKEN
        , authorization: 'Bearer x'
        , host: 'stf'
        }
      } as never)
      expect(headers).to.eql({cookie: 'ssid=a; ssid.sig=b', 'x-stf-internal-token': TOKEN})
    })
  })

  describe('middleware', function() {
    var server: Running

    async function serve(options: Parameters<typeof storageauth.middleware>[0]) {
      var app = express()
      app.use(storageauth.middleware(options))
      app.get('/s/blob/:id/:name', function(req, res) {
        res.send('blob')
      })
      server = await listen(app)
    }

    afterEach(async function() {
      await server.close()
    })

    it('should leave the routes open without a token, as upstream', async function() {
      await serve({secret: SECRET})
      expect((await fetch(server.origin + '/s/blob/a/b')).status).to.equal(200)
    })

    it('should refuse a token without the secret of the sessions', function() {
      expect(function() {
        storageauth.middleware({storageToken: TOKEN})
      }).to.throw(/secret of the session cookies/)
      server = {origin: '', close: () => Promise.resolve()}
    })

    describe('with a secret and a token', function() {
      beforeEach(async function() {
        await serve({secret: SECRET, storageToken: TOKEN})
      })

      it('should refuse an anonymous request', async function() {
        var res = await fetch(server.origin + '/s/blob/a/b')
        expect(res.status).to.equal(401)
        expect(await res.json()).to.eql({success: false, error: 'Unauthorized'})
      })

      it('should let a unit with the token in', async function() {
        var res = await fetch(server.origin + '/s/blob/a/b', {
          headers: {'x-stf-internal-token': TOKEN}
        })
        expect(res.status).to.equal(200)
      })

      it('should refuse a wrong token', async function() {
        for (var token of ['storage-test-tokeN', 'short', TOKEN + 'x']) {
          var res = await fetch(server.origin + '/s/blob/a/b', {
            headers: {'x-stf-internal-token': token}
          })
          expect(res.status, token).to.equal(401)
        }
      })

      it('should let a signed-in user in', async function() {
        var cookie = await sessionCookie(SECRET, {jwt: {email: 'user@example.com', name: 'U'}})
        var res = await fetch(server.origin + '/s/blob/a/b', {headers: {cookie: cookie}})
        expect(res.status).to.equal(200)
      })

      it('should refuse a session signed with another secret', async function() {
        var cookie = await sessionCookie('other', {jwt: {email: 'user@example.com', name: 'U'}})
        var res = await fetch(server.origin + '/s/blob/a/b', {headers: {cookie: cookie}})
        expect(res.status).to.equal(401)
      })

      it('should refuse a session without a signed-in user', async function() {
        var cookie = await sessionCookie(SECRET, {other: true})
        var res = await fetch(server.origin + '/s/blob/a/b', {headers: {cookie: cookie}})
        expect(res.status).to.equal(401)
      })

      it('should refuse a session cookie without its signature', async function() {
        var cookie = await sessionCookie(SECRET, {jwt: {email: 'user@example.com', name: 'U'}})
        var unsigned = cookie.split('; ').filter(function(part) {
          return !part.startsWith('ssid.sig=')
        }).join('; ')
        var res = await fetch(server.origin + '/s/blob/a/b', {headers: {cookie: unsigned}})
        expect(res.status).to.equal(401)
      })
    })
  })

  describe('temp storage, apk and image plugins', function() {
    var directory: string, storage: Running, apk: Running, unsafe: Running, userCookie: string
      , files: Storage | undefined
    var token = {'x-stf-internal-token': TOKEN}

    before(async function() {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-zebrunner-storage-'))
      // The storage keeps a timer, it is stopped after the tests
      var restoreStorage = mockModule(new URL('../../../lib/util/storage.js', import.meta.url), {
        default: function() {
          files = new Storage()
          return files
        }
      })
      try {
        storage = await startUnit(new URL('../../../lib/units/storage/temp.js', import.meta.url), {
          saveDir: directory
        , cacheDir: directory
        , maxFileSize: 1024 * 1024
        , secret: SECRET
        , storageToken: TOKEN
        , ssid: 'ssid'
        })
      }
      finally {
        restoreStorage()
      }
      var apkUnit = new URL('../../../lib/units/storage/plugins/apk/index.js', import.meta.url)
      apk = await startUnit(apkUnit, {storageUrl: storage.origin + '/', cacheDir: directory})
      unsafe = await listen(function(req, res) {
        res.end('internal')
      })
      userCookie = await sessionCookie(SECRET, {jwt: {email: 'user@example.com', name: 'U'}})
    })

    after(async function() {
      await apk.close()
      await storage.close()
      await unsafe.close()
      files?.stop()
      await fs.rm(directory, {recursive: true, force: true})
    })

    it('should refuse an anonymous upload', async function() {
      expect((await upload(storage.origin)).status).to.equal(401)
    })

    it('should store and serve a file for the units and the users', async function() {
      var res = await upload(storage.origin, token)
      expect(res.status).to.equal(201)
      var href = (await res.json() as {resources: {file: {href: string}}}).resources.file.href
      var id = href.split('/')[3]
      var blob = '/s/blob/' + id + '/app.apk'

      expect((await fetch(storage.origin + blob)).status).to.equal(401)
      expect(await (await fetch(storage.origin + blob, {headers: token})).text())
        .to.equal('apk content')
      expect(await (await fetch(storage.origin + blob, {headers: {cookie: userCookie}})).text())
        .to.equal('apk content')
    })

    it('should forward the credentials of the caller of the apk plugin', async function() {
      var res = await upload(storage.origin, {cookie: userCookie})
      expect(res.status).to.equal(201)
      var href = (await res.json() as {resources: {file: {href: string}}}).resources.file.href

      expect((await fetch(apk.origin + href)).status).to.equal(401)
      var asUnit = await fetch(apk.origin + href, {headers: token})
      expect(asUnit.status).to.equal(200)
      expect(await asUnit.text()).to.equal('apk content')
      var asUser = await fetch(apk.origin + href, {headers: {cookie: userCookie}})
      expect(await asUser.text()).to.equal('apk content')
    })

    it('should forward the credentials of the image plugin', async function() {
      var res = await upload(storage.origin, token)
      var href = (await res.json() as {resources: {file: {href: string}}}).resources.file.href
      var blob = href.replace(/^\/s\/apk\//, '/s/blob/')
      var options = {storageUrl: storage.origin + '/'}

      var anonymous = await getImage(blob, options).then(
        function() {
          return 'resolved'
        }
      , function(err: Error) {
          return err.message
        }
      )
      expect(anonymous).to.equal('HTTP 401')
      var stream = await getImage(blob, options, {cookie: userCookie})
      var chunks: Buffer[] = []
      for await (var chunk of stream) {
        chunks.push(chunk as Buffer)
      }
      expect(Buffer.concat(chunks).toString()).to.equal('apk content')
    })

    it('should refuse an anonymous download from a URL', async function() {
      var res = await fetch(storage.origin + '/s/download/apk', {
        method: 'POST'
      , headers: {'content-type': 'application/json'}
      , body: JSON.stringify({url: 'https://8.8.8.8/app.apk'})
      })
      expect(res.status).to.equal(401)
    })

    it('should refuse to download from an internal address', async function() {
      var res = await fetch(storage.origin + '/s/download/apk', {
        method: 'POST'
      , headers: {'content-type': 'application/json', cookie: userCookie}
      , body: JSON.stringify({url: unsafe.origin + '/latest/meta-data/'})
      })
      expect(res.status).to.equal(400)
      var body = await res.json() as {error: string, validationErrors: Array<{msg: string}>}
      expect(body.error).to.equal('ValidationError')
      expect(body.validationErrors[0]!.msg).to.equal('URL resolves to a restricted address')
    })
  })
})
