// Fork (Zebrunner): the cleanup between the uses of a device: what it keeps (lib/util/zebrunner-cleanup.ts, also the
// one of Android) and the cleanup of iOS (lib/units/ios-device/plugins/cleanup.ts) with a fake go-ios on the PATH
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Bluebird from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'

import {keepMatcher} from '../../../lib/util/zebrunner-cleanup.js'
import {parseApps} from '../../../lib/units/ios-device/plugins/cleanup.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)
var SERIAL = 'udid-1'

// The fake go-ios: `apps` prints the apps of FAKE_GO_IOS_APPS (a JSON array of bundle ids) as go-ios does,
// `uninstall <id>` records the call in FAKE_GO_IOS_CALLS and removes the app; FAKE_GO_IOS_APPS_FAIL fails `apps`
var FAKE_GO_IOS = `#!/usr/bin/env node
var fs = require('fs')
var args = process.argv.slice(2).filter(function(arg) { return !arg.startsWith('--udid=') })
var appsFile = process.env.FAKE_GO_IOS_APPS
console.error(JSON.stringify({level: 'WARN', msg: 'go-ios agent is not running. Start it'}))
if (args[0] === 'apps') {
  if (process.env.FAKE_GO_IOS_APPS_FAIL) {
    var failure = {level: 'error', msg: 'failed getting app list', err: 'no device'}
    console.error(JSON.stringify(failure))
    process.exit(1)
  }
  var ids = JSON.parse(fs.readFileSync(appsFile, 'utf8'))
  console.log(JSON.stringify(ids.map(function(id) {
    return {ApplicationType: 'User', CFBundleIdentifier: id, CFBundleName: id}
  })))
}
else if (args[0] === 'uninstall') {
  var delay = Number(process.env.FAKE_GO_IOS_UNINSTALL_DELAY || 0)
  var until = Date.now() + delay
  while (Date.now() < until) {}
  fs.appendFileSync(process.env.FAKE_GO_IOS_CALLS, args[1] + '\\n')
  var left = JSON.parse(fs.readFileSync(appsFile, 'utf8'))
    .filter(function(id) { return id !== args[1] })
  fs.writeFileSync(appsFile, JSON.stringify(left))
}
else {
  process.exit(2)
}
`

describe('zebrunner: the cleanup of a device', function() {
  describe('keepMatcher', function() {
    it('should keep the exact ids and the prefixes ending with *', function() {
      var keep = keepMatcher(['io.appium.settings', 'com.hmdm.*'])
      expect(keep('io.appium.settings')).to.equal(true)
      expect(keep('com.hmdm.launcher')).to.equal(true)
      expect(keep('com.hmdm.pager')).to.equal(true)
      expect(keep('io.appium.settings.extra')).to.equal(false)
      expect(keep('com.example.app')).to.equal(false)
    })

    it('should split a value of the environment on commas and spaces', function() {
      var keep = keepMatcher([
        'io.appium.uiautomator2.server, io.appium.uiautomator2.server.test  com.hmdm.*'
      ])
      expect(keep('io.appium.uiautomator2.server')).to.equal(true)
      expect(keep('io.appium.uiautomator2.server.test')).to.equal(true)
      expect(keep('com.hmdm.launcher')).to.equal(true)
      expect(keep('io.appium.uiautomator2')).to.equal(false)
    })

    it('should keep nothing without patterns', function() {
      expect(keepMatcher([])('com.example.app')).to.equal(false)
      expect(keepMatcher()('com.example.app')).to.equal(false)
      expect(keepMatcher([' , '])('com.example.app')).to.equal(false)
    })
  })

  describe('parseApps', function() {
    it('should read the bundle ids of the JSON list of go-ios', function() {
      var stdout = JSON.stringify([
        {CFBundleIdentifier: 'com.facebook.WebDriverAgentRunner.xctrunner'}
      , {CFBundleIdentifier: 'com.example.app'}
      , {CFBundleName: 'no id'}
      ]) + '\n'
      expect(parseApps(stdout)).to.deep.equal([
        'com.facebook.WebDriverAgentRunner.xctrunner'
      , 'com.example.app'
      ])
    })

    it('should find the list among other lines', function() {
      var stdout = 'a log line\n[{"CFBundleIdentifier":"com.example.app"}]\n'
      expect(parseApps(stdout)).to.deep.equal(['com.example.app'])
    })

    it('should fail without a list', function() {
      expect(function() {
        parseApps('nothing\n')
      }).to.throw('no list')
    })
  })

  describe('iOS', function() {
    var bin: string
      , work: string
      , appsFile: string
      , callsFile: string
      , originalPath: string | undefined

    before(function() {
      bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-fake-go-ios-'))
      fs.writeFileSync(path.join(bin, 'ios'), FAKE_GO_IOS, {mode: 0o755})
      originalPath = process.env.PATH
      process.env.PATH = bin + path.delimiter + originalPath
    })

    after(function() {
      process.env.PATH = originalPath
      fs.rmSync(bin, {recursive: true, force: true})
    })

    beforeEach(function() {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cleanup-'))
      appsFile = path.join(work, 'apps.json')
      callsFile = path.join(work, 'calls')
      fs.writeFileSync(callsFile, '')
      process.env.FAKE_GO_IOS_APPS = appsFile
      process.env.FAKE_GO_IOS_CALLS = callsFile
      delete process.env.FAKE_GO_IOS_APPS_FAIL
    })

    afterEach(function() {
      delete process.env.FAKE_GO_IOS_APPS
      delete process.env.FAKE_GO_IOS_CALLS
      delete process.env.FAKE_GO_IOS_APPS_FAIL
      delete process.env.FAKE_GO_IOS_UNINSTALL_DELAY
      fs.rmSync(work, {recursive: true, force: true})
    })

    function setApps(ids: string[]) {
      fs.writeFileSync(appsFile, JSON.stringify(ids))
    }

    function uninstalled() {
      return fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean)
    }

    async function load(options: {cleanup: boolean, cleanupKeepPackages: string[]}) {
      var group = Object.assign(new EventEmitter(), {
        get: function() {
          return Bluebird.resolve({group: 'group-1'})
        }
      })
      var restore = mockModule(new URL('units/ios-device/plugins/group.js', lib), {
        default: syrup.serial().define(function() {
          return group
        })
      })
      try {
        var mod = await importFresh(new URL('units/ios-device/plugins/cleanup.js', lib))
        mod.startRetry.attempts = 2
        mod.startRetry.delay = 10
        var plugin = await mod.default.consume({serial: SERIAL, ...options})
        return {plugin: plugin, group: group}
      }
      finally {
        restore()
      }
    }

    it('should uninstall the new apps but WebDriverAgent and the kept ones', async function() {
      setApps(['com.facebook.WebDriverAgentRunner.xctrunner', 'com.preinstalled.app'])
      var {plugin} = await load({cleanup: true, cleanupKeepPackages: ['com.kept.*']})
      // the first call waits for the apps of the start: nothing is new yet
      expect(await plugin.removeApps()).to.deep.equal([])

      setApps([
        'com.facebook.WebDriverAgentRunner.xctrunner'
      , 'com.preinstalled.app'
      , 'com.user.app'
      , 'com.kept.tool'
      , 'com.other.WebDriverAgentRunner.xctrunner'
      , 'com.another.user.app'
      ])
      expect(await plugin.removeApps()).to.deep.equal(['com.user.app', 'com.another.user.app'])
      expect(uninstalled()).to.deep.equal(['com.user.app', 'com.another.user.app'])
      expect(JSON.parse(fs.readFileSync(appsFile, 'utf8'))).to.deep.equal([
        'com.facebook.WebDriverAgentRunner.xctrunner'
      , 'com.preinstalled.app'
      , 'com.kept.tool'
      , 'com.other.WebDriverAgentRunner.xctrunner'
      ])
    })

    it('should clean up when the device is released', async function() {
      setApps(['com.preinstalled.app'])
      var {plugin, group} = await load({cleanup: true, cleanupKeepPackages: []})
      await plugin.removeApps()
      setApps(['com.preinstalled.app', 'com.user.app'])
      group.emit('leave', {group: 'group-1'})
      for (var i = 0; i < 250 && uninstalled().length === 0; i++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 20)
        })
      }
      expect(uninstalled()).to.deep.equal(['com.user.app'])
    })

    it('should not clean up a device that is used again at once', async function() {
      setApps(['com.preinstalled.app'])
      var {plugin, group} = await load({cleanup: true, cleanupKeepPackages: []})
      await plugin.removeApps()
      setApps(['com.preinstalled.app', 'com.same.app'])
      group.emit('leave', {group: 'group-1'})
      group.emit('join', {group: 'group-2'})
      await new Promise(function(resolve) {
        setTimeout(resolve, 300)
      })
      expect(uninstalled()).to.deep.equal([])
    })

    it('should start no other uninstall once the device is used again', async function() {
      setApps(['com.preinstalled.app'])
      var {plugin, group} = await load({cleanup: true, cleanupKeepPackages: []})
      await plugin.removeApps()
      setApps(['com.preinstalled.app', 'com.first.app', 'com.second.app', 'com.third.app'])
      process.env.FAKE_GO_IOS_UNINSTALL_DELAY = '200'
      group.emit('leave', {group: 'group-1'})
      for (var i = 0; i < 250 && uninstalled().length === 0; i++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 10)
        })
      }
      group.emit('join', {group: 'group-2'})
      await new Promise(function(resolve) {
        setTimeout(resolve, 800)
      })
      expect(uninstalled()).to.deep.equal(['com.first.app'])
    })

    it('should not touch the apps with --no-cleanup', async function() {
      setApps(['com.preinstalled.app'])
      var {plugin, group} = await load({cleanup: false, cleanupKeepPackages: []})
      setApps(['com.preinstalled.app', 'com.user.app'])
      group.emit('leave', {group: 'group-1'})
      expect(await plugin.removeApps()).to.deep.equal([])
      await new Promise(function(resolve) {
        setTimeout(resolve, 100)
      })
      expect(uninstalled()).to.deep.equal([])
    })

    it('should be off without failing the unit when the apps are not listed', async function() {
      process.env.FAKE_GO_IOS_APPS_FAIL = '1'
      setApps(['com.preinstalled.app'])
      var {plugin} = await load({cleanup: true, cleanupKeepPackages: []})
      expect(await plugin.removeApps()).to.deep.equal([])
      delete process.env.FAKE_GO_IOS_APPS_FAIL
      setApps(['com.preinstalled.app', 'com.user.app'])
      expect(await plugin.removeApps()).to.deep.equal([])
      expect(uninstalled()).to.deep.equal([])
    })
  })
})
