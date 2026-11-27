// Fork (Zebrunner): the cleanup between the uses of a device: what it keeps (lib/util/zebrunner-cleanup.ts, also the
// one of Android), the cleanup of iOS (lib/units/ios-device/plugins/cleanup.ts) with a fake go-ios on the PATH and the
// reset of the state (lib/util/zebrunner-reset.ts) of Android with a fake adb shell, of iOS with the fake go-ios
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Bluebird from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'

import {
  BASELINE_DIR
, baselineFile
, keepMatcher
, keptBaseline
, keptWebDriverAgents
, stateBaselineFile
} from '../../../lib/util/zebrunner-cleanup.js'
import {
  ANDROID_RESET_STEPS
, DEFAULT_RESET_STEPS
, IOS_RESET_STEPS
, added
, androidBaselineNow
, androidReset
, parseAccountTypes
, parseDeviceAdmins
, parseProfiles
, parseSettings
, parseWifiNetworks
, proxyKeys
, resetSteps
, splitAccessibility
, splitList
} from '../../../lib/util/zebrunner-reset.js'
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
else if (args[0] === 'profile' && args[1] === 'list') {
  // FAKE_GO_IOS_PROFILES: a JSON array of the identifiers of the profiles, none: no profiles
  var profilesFile = process.env.FAKE_GO_IOS_PROFILES
  var profiles = profilesFile && fs.existsSync(profilesFile) ?
    JSON.parse(fs.readFileSync(profilesFile, 'utf8')) : []
  console.log(JSON.stringify(profiles.map(function(id) {
    return {Identifier: id, Manifest: {Description: id, IsActive: true}, Status: 'Acknowledged'}
  })))
}
else if (args[0] === 'profile' && args[1] === 'remove') {
  fs.appendFileSync(process.env.FAKE_GO_IOS_CALLS, 'profile:' + args[2] + '\\n')
  var kept = JSON.parse(fs.readFileSync(process.env.FAKE_GO_IOS_PROFILES, 'utf8'))
    .filter(function(id) { return id !== args[2] })
  fs.writeFileSync(process.env.FAKE_GO_IOS_PROFILES, JSON.stringify(kept))
}
else if (args[0] === 'uninstall') {
  // FAKE_GO_IOS_STARTED: the uninstalls that started, before the slow ones
  // (FAKE_GO_IOS_UNINSTALL_DELAY) end
  if (process.env.FAKE_GO_IOS_STARTED) {
    fs.appendFileSync(process.env.FAKE_GO_IOS_STARTED, args[1] + '\\n')
  }
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

    it('should find the exact WebDriverAgent of the keep list', function() {
      expect(keptWebDriverAgents(['io.appium.settings, com.example.WDA.xctrunner'])).to.deep.equal([
        'com.example.WDA.xctrunner'
      ])
      expect(keptWebDriverAgents(['com.example.*', '*.xctrunner'])).to.deep.equal([])
      expect(keptWebDriverAgents()).to.deep.equal([])
    })

    it('should keep nothing without patterns', function() {
      expect(keepMatcher([])('com.example.app')).to.equal(false)
      expect(keepMatcher()('com.example.app')).to.equal(false)
      expect(keepMatcher([' , '])('com.example.app')).to.equal(false)
    })
  })

  describe('keptBaseline', function() {
    var dir: string

    beforeEach(function() {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-baseline-'))
    })

    afterEach(function() {
      fs.rmSync(dir, {recursive: true, force: true})
    })

    it('should keep the apps of the first start over the later ones', async function() {
      var file = baselineFile('serial/1', dir)
      expect(path.dirname(file)).to.equal(dir)
      expect(await keptBaseline('serial/1', ['a', 'b'], file)).to.deep.equal(['a', 'b'])
      expect(fs.statSync(file).mode & 0o777).to.equal(0o600)
      // a restart of the unit with an app a user installed meanwhile: the first list stays
      expect(await keptBaseline('serial/1', ['a', 'b', 'user.app'], file)).to.deep.equal(['a', 'b'])
    })

    it('should start a new list over a broken file', async function() {
      var file = baselineFile('serial-2', dir)
      fs.writeFileSync(file, '{"not": "a list"}')
      expect(await keptBaseline('serial-2', ['a'], file)).to.deep.equal(['a'])
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal(['a'])
    })

    it('should keep the apps of this start when the file cannot be written', async function() {
      var file = path.join(dir, 'missing', 'baseline.json')
      expect(await keptBaseline('serial-3', ['a'], file)).to.deep.equal(['a'])
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
    // every call of the fake go-ios starts a node process: a few hundred milliseconds each on a busy runner
    this.timeout(20000)

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
      process.env.FAKE_GO_IOS_PROFILES = path.join(work, 'profiles.json')
      process.env[BASELINE_DIR] = work
      delete process.env.FAKE_GO_IOS_APPS_FAIL
    })

    afterEach(function() {
      delete process.env.FAKE_GO_IOS_APPS
      delete process.env.FAKE_GO_IOS_CALLS
      delete process.env.FAKE_GO_IOS_APPS_FAIL
      delete process.env.FAKE_GO_IOS_UNINSTALL_DELAY
      delete process.env.FAKE_GO_IOS_STARTED
      delete process.env.FAKE_GO_IOS_PROFILES
      delete process.env[BASELINE_DIR]
      fs.rmSync(work, {recursive: true, force: true})
    })

    function setApps(ids: string[]) {
      fs.writeFileSync(appsFile, JSON.stringify(ids))
    }

    function calls() {
      return fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean)
    }

    function uninstalled() {
      return calls().filter(function(call) {
        return !call.startsWith('profile:')
      })
    }

    function setProfiles(ids: string[]) {
      fs.writeFileSync(path.join(work, 'profiles.json'), JSON.stringify(ids))
    }

    function removedProfiles() {
      return calls()
        .filter(function(call) {
          return call.startsWith('profile:')
        })
        .map(function(call) {
          return call.slice('profile:'.length)
        })
    }

    async function load(options: {
      cleanup: boolean
      cleanupKeepPackages: string[]
      cleanupReset?: string[]
      cleanupKeepProfiles?: string[]
    }) {
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
        var plugin = await mod.default.consume({
          serial: SERIAL
        , cleanupReset: DEFAULT_RESET_STEPS
        , cleanupKeepProfiles: []
        , ...options
        })
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

    it('should keep only the WebDriverAgent of the keep list when it has one', async function() {
      var wda = 'com.example.WebDriverAgentRunner.xctrunner'
      setApps([wda])
      var {plugin} = await load({cleanup: true, cleanupKeepPackages: [wda]})
      expect(await plugin.removeApps()).to.deep.equal([])
      setApps([wda, 'com.user.disguised.xctrunner'])
      expect(await plugin.removeApps()).to.deep.equal(['com.user.disguised.xctrunner'])
    })

    it('should keep the apps of the first start over a restart of the unit', async function() {
      setApps(['com.preinstalled.app'])
      var first = await load({cleanup: true, cleanupKeepPackages: []})
      await first.plugin.removeApps()
      // a user installs an app and the device reboots: the unit starts again
      setApps(['com.preinstalled.app', 'com.user.app'])
      var again = await load({cleanup: true, cleanupKeepPackages: []})
      expect(await again.plugin.removeApps()).to.deep.equal(['com.user.app'])
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
      var started = path.join(work, 'started')
      fs.writeFileSync(started, '')
      process.env.FAKE_GO_IOS_STARTED = started
      // the first uninstall runs long enough for the device to be taken while it runs
      process.env.FAKE_GO_IOS_UNINSTALL_DELAY = '1000'
      group.emit('leave', {group: 'group-1'})
      for (var i = 0; i < 500 && fs.readFileSync(started, 'utf8') === ''; i++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 10)
        })
      }
      group.emit('join', {group: 'group-2'})
      for (var j = 0; j < 500 && uninstalled().length === 0; j++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 10)
        })
      }
      // time for a next uninstall to start, if the cleanup went on
      await new Promise(function(resolve) {
        setTimeout(resolve, 300)
      })
      var startedIds = fs.readFileSync(started, 'utf8').split('\n').filter(Boolean)
      expect(startedIds).to.deep.equal(['com.first.app'])
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

    it('should remove the profiles of a user but the ones of the farm', async function() {
      setApps(['com.preinstalled.app'])
      setProfiles(['com.zebrunner.mcloud.mdm', 'com.apple.configurator.usbrestrictedmode'])
      var {plugin, group} = await load({
        cleanup: true
      , cleanupKeepPackages: []
      , cleanupKeepProfiles: ['com.example.kept.*']
      })
      expect(await plugin.removeProfiles()).to.deep.equal([])

      setProfiles([
        'com.zebrunner.mcloud.mdm'
      , 'com.apple.configurator.usbrestrictedmode'
      , 'com.zebrunner.mcloud.wifi'
      , 'com.zebrunner.mcloud.mdm.preset.erase-off'
      , 'com.example.kept.vpn'
      , 'com.user.rootca'
      , 'com.zebrunner.mcloud.mdm.preset.disguised'
      ])
      setApps(['com.preinstalled.app', 'com.user.app'])
      group.emit('leave', {group: 'group-1'})
      for (var i = 0; i < 250 && removedProfiles().length < 2; i++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 20)
        })
      }
      expect(uninstalled()).to.deep.equal(['com.user.app'])
      // the apps first, then the profiles
      expect(calls()).to.deep.equal([
        'com.user.app'
      , 'profile:com.user.rootca'
      , 'profile:com.zebrunner.mcloud.mdm.preset.disguised'
      ])
    })

    it('should keep the profiles of the first start over a restart of the unit', async function() {
      setApps(['com.preinstalled.app'])
      setProfiles(['com.operator.profile'])
      var first = await load({cleanup: true, cleanupKeepPackages: []})
      expect(await first.plugin.removeProfiles()).to.deep.equal([])
      expect(fs.existsSync(stateBaselineFile(SERIAL, 'profiles'))).to.equal(true)
      setProfiles(['com.operator.profile', 'com.user.profile'])
      var again = await load({cleanup: true, cleanupKeepPackages: []})
      expect(await again.plugin.removeProfiles()).to.deep.equal(['com.user.profile'])
    })

    it('should not remove the profiles without the step profiles', async function() {
      setApps(['com.preinstalled.app'])
      setProfiles([])
      var {plugin} = await load({
        cleanup: true
      , cleanupKeepPackages: []
      , cleanupReset: ['proxy,wifi']
      })
      // the apps of the start
      expect(await plugin.removeApps()).to.deep.equal([])
      setProfiles(['com.user.profile'])
      expect(await plugin.removeProfiles()).to.deep.equal([])
      expect(removedProfiles()).to.deep.equal([])
      // the apps are still cleaned up
      setApps(['com.preinstalled.app', 'com.user.app'])
      expect(await plugin.removeApps()).to.deep.equal(['com.user.app'])
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

  describe('the reset of the state', function() {
    it('should pick the steps of the platform, none, and warn about unknown ones', function() {
      var warnings: unknown[][] = []
      var log = {
        debug: function() {}
      , info: function() {}
      , warn: function(...args: unknown[]) {
          warnings.push(args)
        }
      }
      expect(Array.from(resetSteps(DEFAULT_RESET_STEPS, ANDROID_RESET_STEPS))).to.deep.equal([
        'proxy', 'dns', 'accessibility', 'clipboard', 'wifi', 'downloads', 'report'
      ])
      expect(Array.from(resetSteps(DEFAULT_RESET_STEPS, IOS_RESET_STEPS))).to.deep.equal([
        'profiles'
      ])
      expect(Array.from(resetSteps(['proxy,media profiles'], ANDROID_RESET_STEPS))).to.deep.equal([
        'proxy', 'media'
      ])
      expect(resetSteps(['none'], ANDROID_RESET_STEPS).size).to.equal(0)
      expect(resetSteps([], ANDROID_RESET_STEPS).size).to.equal(0)
      expect(Array.from(resetSteps(['proxy,prxy'], ANDROID_RESET_STEPS, log))).to.deep.equal([
        'proxy'
      ])
      expect(warnings).to.have.length(1)
      expect(JSON.stringify(warnings[0])).to.contain('prxy')
    })

    it('should split the lists of the environment', function() {
      expect(splitList(['a, b c', 'd'])).to.deep.equal(['a', 'b', 'c', 'd'])
      // SSIDs keep their spaces
      expect(splitList(['Farm Wi-Fi, Other'], /,/)).to.deep.equal(['Farm Wi-Fi', 'Other'])
      expect(splitList()).to.deep.equal([])
    })

    it('should name the files of the lists of the state apart from the apps', function() {
      var dir = path.join(os.tmpdir(), 'x')
      expect(baselineFile('serial/1', dir))
        .to.equal(path.join(dir, 'stf-cleanup-baseline-serial%2F1.json'))
      expect(baselineFile('serial/1', dir, 'wifi'))
        .to.equal(path.join(dir, 'stf-cleanup-baseline-serial%2F1-wifi.json'))
    })

    it('should find a global proxy that is set', function() {
      var settings = parseSettings([
        'adb_enabled=1'
      , 'http_proxy=10.0.0.1:8888'
      , 'global_http_proxy_port=0'
      , 'global_http_proxy_host='
      , 'global_proxy_pac_url=null'
      , 'some_url=https://example.com/?a=b'
      ].join('\n'))
      expect(settings.get('some_url')).to.equal('https://example.com/?a=b')
      expect(proxyKeys(settings)).to.deep.equal(['http_proxy'])
      // what Android writes when the proxy is off
      var off = parseSettings('http_proxy=:0\nglobal_http_proxy_port=0\n')
      expect(proxyKeys(off)).to.deep.equal([])
      expect(proxyKeys(parseSettings('global_proxy_pac_url=http://pac/\n'))).to.deep.equal([
        'global_proxy_pac_url'
      ])
    })

    it('should keep the accessibility services of the farm only', function() {
      var keep = keepMatcher(['com.hmdm.launcher'])
      var services = 'com.hmdm.launcher/.A11y:com.evil/.Reader$Svc\n'
      expect(splitAccessibility(services, keep)).to.deep.equal({
        kept: ['com.hmdm.launcher/.A11y']
      , removed: ['com.evil/.Reader$Svc']
      })
      expect(splitAccessibility('null\n', keep)).to.deep.equal({kept: [], removed: []})
    })

    it('should read the saved Wi-Fi networks', function() {
      var stdout = [
        'Network Id      SSID                         Security type'
      , '0            SOLVD_DEMO                       wpa2-psk'
      , '3            My Home Wi-Fi                    open'
      ].join('\n') + '\n'
      expect(parseWifiNetworks(stdout)).to.deep.equal([
        {id: '0', ssid: 'SOLVD_DEMO', security: 'wpa2-psk'}
      , {id: '3', ssid: 'My Home Wi-Fi', security: 'open'}
      ])
      expect(parseWifiNetworks('Network Id      SSID                         Security type\n'))
        .to.deep.equal([])
      expect(function() {
        parseWifiNetworks('Unknown command: list-networks\n')
      }).to.throw('no list')
    })

    it('should read the device admins and the types of the accounts, not their names', function() {
      var policy = [
        'Current Device Policy Manager state:'
      , '  Device Owner: '
      , '    admin=ComponentInfo{com.hmdm.launcher/com.hmdm.launcher.AdminReceiver}'
      , '  Enabled Device Admins (User 0, provisioningState: 3):'
      , '    com.hmdm.launcher/.AdminReceiver:'
      , '      testOnlyAdmin=false'
      , '    com.example.locker/com.example.locker.Admin$Receiver:'
      , '      testOnlyAdmin=false'
      , '    mPasswordOwner=-1'
      ].join('\n')
      expect(parseDeviceAdmins(policy)).to.deep.equal([
        'com.hmdm.launcher/.AdminReceiver'
      , 'com.example.locker/com.example.locker.Admin$Receiver'
      ])
      expect(parseDeviceAdmins('No device admins\n')).to.deep.equal([])
      var accounts = [
        'User UserInfo{0:Owner:c13}:'
      , '  Accounts: 2'
      , '    Account {name=someone@example.com, type=com.google}'
      , '    Account {name=other, type=com.example.auth}'
      ].join('\n')
      expect(parseAccountTypes(accounts)).to.deep.equal(['com.example.auth', 'com.google'])
      expect(added(['a', 'a', 'b'], ['a'])).to.deep.equal(['a', 'b'])
    })

    it('should read the identifiers of the profiles of go-ios', function() {
      expect(parseProfiles('[{"Identifier":"com.zebrunner.mcloud.mdm"},{"Manifest":{}}]\n'))
        .to.deep.equal(['com.zebrunner.mcloud.mdm'])
      expect(parseProfiles('null\n')).to.deep.equal([])
      expect(function() {
        parseProfiles('nothing\n')
      }).to.throw('no list')
    })

    // A fake Android device: the commands of adb shell the reset uses, on a model of its state
    interface FakeState {
      global: Record<string, string>
      secure: Record<string, string>
      wifi: Array<{id: string, ssid: string, security: string}>
      folders: Record<string, string[]>
      admins: string[]
      accounts: string[]
      clipboard: string
      calls: string[][]
      fail: string[]
    }

    function fakeState(): FakeState {
      return {
        global: {adb_enabled: '1'}
      , secure: {accessibility_enabled: '0'}
      , wifi: [{id: '0', ssid: 'SOLVD_DEMO', security: 'wpa2-psk'}]
      , folders: {'/sdcard/Download': [], '/sdcard/DCIM': []}
      , admins: ['com.hmdm.launcher/.AdminReceiver']
      , accounts: []
      , clipboard: 'a secret of the previous user'
      , calls: []
      , fail: []
      }
    }

    function fakeShell(state: FakeState) {
      return function(args: string[]): Promise<string> {
        state.calls.push(args)
        var line = args.join(' ')
        if (state.fail.some(function(prefix) {
          return line.startsWith(prefix)
        })) {
          return Promise.reject(new Error('fake failure of ' + line))
        }
        var [command, sub, a, b, c] = args
        var out = ''
        if (command === 'settings') {
          var table = a === 'global' ? state.global : state.secure
          if (sub === 'list') {
            out = Object.entries(table).map(function([key, value]) {
              return key + '=' + value
            }).join('\n') + '\n'
          }
          else if (sub === 'get') {
            out = (b && b in table ? table[b] : 'null') + '\n'
          }
          else if (sub === 'put' && b) {
            table[b] = c || ''
            // Android turns the proxy off and writes the keys of it
            if (a === 'global' && b === 'http_proxy' && c === ':0') {
              Object.assign(table, {
                global_http_proxy_host: ''
              , global_http_proxy_port: '0'
              , global_http_proxy_exclusion_list: ''
              , global_proxy_pac_url: ''
              })
            }
          }
          else if (sub === 'delete' && b) {
            delete table[b]
          }
        }
        else if (command === 'cmd' && sub === 'wifi' && a === 'list-networks') {
          out = 'Network Id'.padEnd(12) + '    ' + 'SSID'.padEnd(32) + ' Security type\n' +
            state.wifi.map(function(network) {
              return network.id.padEnd(12) + ' ' + network.ssid.padEnd(32) + ' ' + network.security
            }).join('\n') + '\n'
        }
        else if (command === 'cmd' && sub === 'wifi' && a === 'forget-network') {
          state.wifi = state.wifi.filter(function(network) {
            return network.id !== b
          })
          out = 'Forget successful\n'
        }
        else if (command === 'dumpsys' && sub === 'device_policy') {
          out = '  Enabled Device Admins (User 0, provisioningState: 3):\n' +
            state.admins.map(function(admin) {
              return '    ' + admin + ':\n      testOnlyAdmin=false\n'
            }).join('')
        }
        else if (command === 'dumpsys' && sub === 'account') {
          out = '  Accounts: ' + state.accounts.length + '\n' +
            state.accounts.map(function(type, i) {
              return '    Account {name=user' + i + '@example.com, type=' + type + '}\n'
            }).join('')
        }
        else if (command === 'find' && sub) {
          var entries = state.folders[sub]
          if (!entries) {
            out = 'find: ' + sub + ': No such file or directory\n'
          }
          else if (args.includes('-exec')) {
            state.folders[sub] = []
          }
          else {
            out = entries.map(function(name) {
              return sub + '/' + name + '\n'
            }).join('')
          }
        }
        return Promise.resolve(out)
      }
    }

    function quietLog() {
      var lines: string[] = []
      function record(level: string) {
        return function(...args: unknown[]) {
          lines.push(level + ' ' + args.map(function(arg) {
            return typeof arg === 'string' ? arg : JSON.stringify(arg)
          }).join(' '))
        }
      }
      return {debug: record('debug'), info: record('info'), warn: record('warn'), lines: lines}
    }

    async function reset(state: FakeState, options: {
      steps?: string[]
      keep?: string[]
      keepWifi?: string[]
      baseline?: FakeState
    } = {}) {
      var log = quietLog()
      var shell = fakeShell(state)
      var steps = resetSteps(options.steps || DEFAULT_RESET_STEPS, ANDROID_RESET_STEPS)
      var baseline = await androidBaselineNow(fakeShell(options.baseline || state), steps, log)
      var clipboard: string[] = []
      var done = await androidReset({
        shell: shell
      , steps: steps
      , log: log
      , keep: keepMatcher(options.keep || ['com.hmdm.launcher', 'io.appium.settings'])
      , keepWifi: options.keepWifi || []
      , baseline: baseline
      , setClipboard: function(text: string) {
          clipboard.push(text)
          state.clipboard = text
          return Promise.resolve()
        }
      })
      return {done: done, log: log.lines, clipboard: clipboard}
    }

    it('should reset what a user left and keep the setup of the farm', async function() {
      var before = fakeState()
      before.folders['/sdcard/Download'] = ['hmdm_stack_trace.txt']
      var state = fakeState()
      Object.assign(state.global, {
        http_proxy: '10.1.2.3:8080'
      , global_http_proxy_host: '10.1.2.3'
      , global_http_proxy_port: '8080'
      , private_dns_mode: 'hostname'
      , private_dns_specifier: 'dns.example.com'
      })
      state.secure.enabled_accessibility_services =
        'com.hmdm.launcher/.Accessibility:com.user.keylogger/.Svc$Inner'
      state.secure.accessibility_enabled = '1'
      state.wifi.push({id: '4', ssid: 'Attacker AP', security: 'open'})
      state.wifi.push({id: '5', ssid: 'SOLVD_DEMO', security: 'open'})
      state.folders['/sdcard/Download'] = ['payload.apk', '.hidden']
      state.folders['/sdcard/DCIM'] = ['Camera']
      state.admins.push('com.user.locker/.Admin')
      state.accounts.push('com.google')

      var {done, log, clipboard} = await reset(state, {baseline: before})
      expect(done).to.deep.equal([
        'proxy', 'dns', 'accessibility', 'clipboard', 'wifi', 'downloads', 'report'
      ])
      // the proxy is turned off at once (":0"), then its keys are deleted
      var put = state.calls.findIndex(function(call) {
        return call.join(' ') === 'settings put global http_proxy :0'
      })
      expect(put).to.be.greaterThan(-1)
      expect(state.global).to.deep.equal({adb_enabled: '1'})
      expect(state.secure).to.deep.equal({
        accessibility_enabled: '1'
      , enabled_accessibility_services: 'com.hmdm.launcher/.Accessibility'
      })
      expect(clipboard).to.deep.equal([''])
      // the network of the farm stays, an open one of its name does not
      expect(state.wifi).to.deep.equal([{id: '0', ssid: 'SOLVD_DEMO', security: 'wpa2-psk'}])
      expect(state.folders['/sdcard/Download']).to.deep.equal([])
      // media is not a default step
      expect(state.folders['/sdcard/DCIM']).to.deep.equal(['Camera'])
      // reported, not removed: adb cannot
      expect(log.join('\n')).to.contain('com.user.locker/.Admin')
      expect(log.join('\n')).to.contain('accounts since the first start')
      expect(log.join('\n')).to.contain('com.google')
      expect(log.join('\n')).to.not.contain('example.com')
      expect(log.join('\n')).to.not.contain('payload.apk')
    })

    it('should turn accessibility off when no service of the farm is left', async function() {
      var state = fakeState()
      state.secure.enabled_accessibility_services = 'com.user.keylogger/.Svc'
      state.secure.accessibility_enabled = '1'
      await reset(state, {steps: ['accessibility']})
      expect(state.secure).to.deep.equal({accessibility_enabled: '0'})
    })

    it('should change nothing on a clean device', async function() {
      var state = fakeState()
      var {done} = await reset(state, {
        steps: ['proxy', 'dns', 'accessibility', 'wifi', 'downloads', 'media']
      })
      expect(done).to.have.length(6)
      expect(state.calls.filter(function(call) {
        return ['put', 'delete', 'forget-network', '-exec'].some(function(word) {
          return call.includes(word)
        })
      })).to.deep.equal([])
    })

    it('should keep the Wi-Fi networks of --cleanup-keep-wifi', async function() {
      var state = fakeState()
      state.wifi = []
      var before = fakeState()
      before.wifi = []
      state.wifi.push({id: '1', ssid: 'Farm Wi-Fi', security: 'wpa2-psk'})
      state.wifi.push({id: '2', ssid: 'Other', security: 'wpa2-psk'})
      await reset(state, {steps: ['wifi'], keepWifi: ['Farm Wi-Fi'], baseline: before})
      expect(state.wifi).to.deep.equal([{id: '1', ssid: 'Farm Wi-Fi', security: 'wpa2-psk'}])
    })

    it('should forget no Wi-Fi network without the networks of the start', async function() {
      var before = fakeState()
      before.fail = ['cmd wifi list-networks']
      var state = fakeState()
      state.wifi.push({id: '4', ssid: 'Attacker AP', security: 'open'})
      var {log} = await reset(state, {steps: ['wifi'], baseline: before})
      expect(state.wifi).to.have.length(2)
      expect(log.join('\n')).to.contain('Wi-Fi networks')
    })

    it('should empty the media folders with the step media only', async function() {
      var state = fakeState()
      state.folders['/sdcard/DCIM'] = ['Camera', 'Screenshots']
      state.folders['/sdcard/Pictures'] = ['a.png']
      await reset(state, {steps: ['media']})
      expect(state.folders['/sdcard/DCIM']).to.deep.equal([])
      expect(state.folders['/sdcard/Pictures']).to.deep.equal([])
    })

    it('should go on with the next steps when one fails', async function() {
      var state = fakeState()
      state.global.http_proxy = '10.1.2.3:8080'
      state.secure.enabled_accessibility_services = 'com.user.keylogger/.Svc'
      state.fail = ['settings list global']
      var {done, log} = await reset(state, {steps: ['proxy', 'dns', 'accessibility']})
      expect(done).to.deep.equal(['accessibility'])
      expect(log.filter(function(line) {
        return line.startsWith('warn Cleanup step')
      })).to.have.length(2)
      expect(state.secure).to.not.have.property('enabled_accessibility_services')
    })

    describe('Android plugin', function() {
      var work: string

      beforeEach(function() {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-cleanup-android-'))
        process.env[BASELINE_DIR] = work
      })

      afterEach(function() {
        delete process.env[BASELINE_DIR]
        fs.rmSync(work, {recursive: true, force: true})
      })

      async function loadAndroid(state: FakeState, packages: string[], options: object) {
        var shell = fakeShell(state)
        var uninstalled: string[] = []
        var clipboard: string[] = []
        var adb = {
          getPackages: function() {
            return Bluebird.resolve(packages.slice())
          }
        , shell: function(_serial: string, args: string[]) {
            return Bluebird.resolve(shell(args))
          }
        , uninstall: function(_serial: string, pkg: string) {
            uninstalled.push(pkg)
            packages.splice(packages.indexOf(pkg), 1)
            return Bluebird.resolve(true)
          }
        , util: {
            readAll: function(output: string) {
              return Bluebird.resolve(Buffer.from(output))
            }
          }
        }
        var service = {
          setClipboard: function(text: string) {
            clipboard.push(text)
            return Bluebird.resolve()
          }
        }
        var group = new EventEmitter()
        var restores = [
          mockModule(new URL('units/device/support/adb.js', lib), {
            default: syrup.serial().define(function() {
              return adb
            })
          })
        , mockModule(new URL('units/device/resources/service.js', lib), {
            default: syrup.serial().define(function() {
              return {pkg: 'jp.co.cyberagent.stf'}
            })
          })
        , mockModule(new URL('units/device/plugins/group.js', lib), {
            default: syrup.serial().define(function() {
              return group
            })
          })
        , mockModule(new URL('units/device/plugins/service.js', lib), {
            default: syrup.serial().define(function() {
              return service
            })
          })
        ]
        try {
          var mod = await importFresh(new URL('units/device/plugins/cleanup.js', lib))
          var plugin = await mod.default.consume({
            serial: 'android-1'
          , cleanup: true
          , cleanupFolder: []
          , cleanupKeepPackages: ['com.hmdm.launcher']
          , cleanupReset: DEFAULT_RESET_STEPS
          , cleanupKeepWifi: []
          , cleanupDisableBluetooth: false
          , cleanupBluetoothBonds: false
          , ...options
          })
          return {plugin: plugin, group: group, uninstalled: uninstalled, clipboard: clipboard}
        }
        finally {
          restores.forEach(function(restore) {
            restore()
          })
        }
      }

      it('should uninstall the new apps, then reset the state, on a release', async function() {
        var state = fakeState()
        var packages = ['com.android.chrome', 'com.hmdm.launcher']
        var {group, uninstalled, clipboard} = await loadAndroid(state, packages, {})
        expect(fs.existsSync(stateBaselineFile('android-1', 'wifi'))).to.equal(true)

        packages.push('com.user.app')
        state.global.http_proxy = '10.1.2.3:8080'
        state.wifi.push({id: '4', ssid: 'Attacker AP', security: 'open'})
        group.emit('leave', {group: 'group-1'})
        for (var i = 0; i < 250 && clipboard.length === 0; i++) {
          await new Promise(function(resolve) {
            setTimeout(resolve, 10)
          })
        }
        expect(uninstalled).to.deep.equal(['com.user.app'])
        expect(state.global).to.not.have.property('http_proxy')
        expect(state.wifi).to.have.length(1)
        expect(clipboard).to.deep.equal([''])
      })

      it('should reset nothing with --cleanup-reset none', async function() {
        var state = fakeState()
        var {plugin} = await loadAndroid(state, ['com.android.chrome'], {cleanupReset: ['none']})
        state.global.http_proxy = '10.1.2.3:8080'
        expect(await plugin.resetState()).to.deep.equal([])
        expect(state.global.http_proxy).to.equal('10.1.2.3:8080')
        // nothing listed at the start either
        expect(state.calls).to.deep.equal([])
      })
    })
  })
})
