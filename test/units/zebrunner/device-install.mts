// Fork (Zebrunner): the installs of the device units take the app from the storage only and run no
// shell: lib/util/storageauth.ts (storageUrl), lib/units/device/plugins/install.ts and
// lib/units/ios-device/plugins/install.ts
import childProcess from 'node:child_process'
import EventEmitter from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type {Readable} from 'node:stream'

import {expect} from 'chai'
import Bluebird from 'bluebird'
import sinon from 'sinon'

import androidInstall from '../../../lib/units/device/plugins/install.js'
import iosInstall from '../../../lib/units/ios-device/plugins/install.js'
import storageauth from '../../../lib/util/storageauth.js'
import wire from '../../../lib/wire/index.js'
import createRouter from '../../../lib/wire/router.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

type TransactionDone = ReturnType<typeof wire.TransactionDoneMessage.decode>

interface Download {
  path: string
  token: string | undefined
}

describe('zebrunner: device installs', function() {
  var storage: Running, downloads: Download[], answer: number
  var app = Buffer.from('PK\u0003\u0004 an app')
  var token = process.env.STF_STORAGE_TOKEN

  before(async function() {
    process.env.STF_STORAGE_TOKEN = 'storage-token'
    storage = await listen(function(req, res) {
      var internal = req.headers['x-stf-internal-token'] as string | undefined
      downloads.push({path: req.url!, token: internal})
      res.statusCode = answer
      res.setHeader('Content-Length', answer === 200 ? app.length : 0)
      res.end(answer === 200 ? app : undefined)
    })
  })

  after(async function() {
    process.env.STF_STORAGE_TOKEN = token
    if (typeof token === 'undefined') {
      delete process.env.STF_STORAGE_TOKEN
    }
    await storage.close()
  })

  beforeEach(function() {
    downloads = []
    answer = 200
  })

  afterEach(function() {
    sinon.restore()
  })

  describe('storageUrl', function() {
    it('should take the files of the storage', function() {
      expect(storageauth.storageUrl('http://stf.example.com/', '/s/blob/a/app.ipa'))
        .to.equal('http://stf.example.com/s/blob/a/app.ipa')
      var base = 'https://stf.example.com:8443/'
      expect(storageauth.storageUrl(base, base + 's/apk/a')).to.equal(base + 's/apk/a')
    })

    ;[
      'http://evil.example.com/s/blob/a'
    , '//evil.example.com/s/blob/a'
    , '@evil.example.com/s/blob/a'
    , '/s/../api/v1/user'
    , '/d/evil.example.com/serial/7400/'
    , 'https://stf.example.com/s/blob/a'
    ].forEach(function(href) {
      it(`should refuse ${href}`, function() {
        expect(function() {
          storageauth.storageUrl('http://stf.example.com/', href)
        }).to.throw(/Not a file of the storage/)
      })
    })
  })

  describe('Android', function() {
    function install(href: string) {
      var router = createRouter()
      var adb = {
        push: sinon.stub().callsFake(function(serial: string, source: Readable) {
          var transfer = new EventEmitter()
          source.on('data', function() {})
          source.on('end', function() {
            transfer.emit('end')
          })
          return Bluebird.resolve(transfer)
        })
      , installRemote: sinon.stub().callsFake(function() {
          return Bluebird.resolve()
        })
      }
      var result = new Promise<TransactionDone>(function(resolve) {
        androidInstall.invoke({serial: 'serial', storageUrl: storage.origin + '/'}, adb, router, {
          send: function(parts: Buffer[]) {
            var envelope = wire.Envelope.decode(parts[1]!)
            if (envelope.type === wire.TransactionDoneMessage.$code) {
              resolve(wire.TransactionDoneMessage.decode(envelope.message))
            }
          }
        })
      })
      router.emit(wire.InstallMessage.$code, 'channel', {
        href: href
      , manifest: JSON.stringify({package: 'com.example.app'})
      , launch: false
      })
      return result
    }

    it('should download a file of the storage with the token', async function() {
      var done = await install('/s/blob/a/app.apk')
      expect(done.data).to.equal('INSTALL_SUCCEEDED')
      expect(downloads).to.eql([{path: '/s/blob/a/app.apk', token: 'storage-token'}])
    })

    it('should refuse an href of another host and send no token', async function() {
      var other = storage.origin.replace('127.0.0.1', 'localhost')
      var done = await install(other + '/s/blob/a/app.apk')
      expect(done.success).to.equal(false)
      expect(done.data).to.equal('INSTALL_ERROR_UNKNOWN')
      expect(downloads).to.eql([])
    })
  })

  describe('iOS', function() {
    var execFile: sinon.SinonStub, calls: string[][]

    beforeEach(function() {
      calls = []
      execFile = sinon.stub(childProcess, 'execFile').callsFake(function(
        file: string
      , args: readonly string[]
      , done: unknown
      ) {
        calls.push([file].concat(args))
        // unzip of a simulator build: the .app of the zip
        if (file === 'unzip') {
          fs.mkdirSync(path.join(args[args.length - 1]!, 'Sim App.app'))
        }
        var callback = done as (err: Error | null, stdout: string) => void
        callback(null, '')
        return {} as childProcess.ChildProcess
      } as never)
    })

    function install(href: string, manifest: object, launch = true) {
      var router = createRouter()
      var result = new Promise<TransactionDone>(function(resolve) {
        iosInstall.invoke({serial: 'udid', storageUrl: storage.origin + '/'}, router, {
          send: function(parts: Buffer[]) {
            var envelope = wire.Envelope.decode(parts[1]!)
            if (envelope.type === wire.TransactionDoneMessage.$code) {
              resolve(wire.TransactionDoneMessage.decode(envelope.message))
            }
          }
        })
      })
      router.emit(wire.InstallMessage.$code, 'channel', {
        href: href
      , manifest: JSON.stringify(manifest)
      , launch: launch
      })
      return result
    }

    function tmpDirs() {
      return calls.flatMap(function(call) {
        return call.filter(function(arg) {
          return arg.includes('/tmp/')
        }).map(function(arg) {
          return arg.replace(/^--path=/, '').split('/').slice(0, 3).join('/')
        })
      })
    }

    async function settled() {
      // the launch is not waited for, the temporary folder is removed after the reply
      await new Promise(function(resolve) {
        setTimeout(resolve, 50)
      })
    }

    it('should install and launch an app of a device without a shell', async function() {
      var done = await install('/s/blob/a/app.ipa', {CFBundleIdentifier: 'com.example.app'})
      await settled()
      expect(done.data).to.equal('INSTALL_SUCCEEDED')
      expect(downloads).to.eql([{path: '/s/blob/a/app.ipa', token: 'storage-token'}])
      expect(calls).to.have.lengthOf(2)
      expect(calls[0]!.slice(0, 2)).to.eql(['ios', 'install'])
      expect(calls[0]![2]).to.match(/^--path=\/tmp\/[0-9a-f-]+\/[0-9a-f-]+$/)
      expect(calls[0]![3]).to.equal('--udid=udid')
      expect(calls[1]).to.eql(['ios', 'launch', 'com.example.app', '--udid=udid'])
      expect(fs.existsSync(tmpDirs()[0]!)).to.equal(false)
    })

    it('should install an app of a simulator build', async function() {
      var manifest = {DTPlatformName: 'iphonesimulator', CFBundleIdentifier: 'com.sim'}
      var done = await install('/s/blob/a/sim.zip', manifest)
      await settled()
      expect(done.data).to.equal('INSTALL_SUCCEEDED')
      expect(calls[0]!.slice(0, 3)).to.eql(['unzip', '-o', '-q'])
      expect(calls[1]!.slice(0, 3)).to.eql(['xcrun', 'simctl', 'install'])
      expect(calls[1]![4]).to.match(/\/Sim App\.app$/)
      expect(calls[2]).to.eql(['xcrun', 'simctl', 'launch', 'udid', 'com.sim'])
    })

    it('should not launch an app whose bundle identifier is a command', async function() {
      var done = await install('/s/blob/a/app.ipa', {CFBundleIdentifier: 'x; touch /tmp/pwned'})
      await settled()
      expect(done.data).to.equal('INSTALL_SUCCEEDED')
      expect(calls.map(function(call) {
        return call[1]
      })).to.eql(['install'])
    })

    var foreign = ['@127.0.0.2/s/blob/a/app.ipa', '//127.0.0.2/s/blob/a/app.ipa', '/api/v1/user']
    foreign.forEach(function(href) {
      it(`should refuse the href ${href} and send no token`, async function() {
        var done = await install(href, {CFBundleIdentifier: 'com.example.app'})
        expect(done.success).to.equal(false)
        expect(downloads).to.eql([])
        expect(execFile.called).to.equal(false)
      })
    })

    it('should not install an answer of the storage that is not the app', async function() {
      answer = 401
      var done = await install('/s/blob/a/app.ipa', {CFBundleIdentifier: 'com.example.app'})
      expect(done.success).to.equal(false)
      expect(execFile.called).to.equal(false)
    })
  })
})
