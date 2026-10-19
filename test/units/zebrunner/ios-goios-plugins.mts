// Fork (Zebrunner): the go-ios plugins of the ios-device unit (lib/units/ios-device/plugins/shell.ts,
// devicelog.ts, filesystem.ts) with a fake go-ios binary on the PATH and their STF side faked
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {Readable} from 'node:stream'

import Bluebird from 'bluebird'
import syrup from '@devicefarmer/stf-syrup'
import {expect} from 'chai'

import wire from '../../../lib/wire/index.js'
import wirerouter from '../../../lib/wire/router.js'
import wireutil from '../../../lib/wire/util.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var lib = new URL('../../../lib/', import.meta.url)
var SERIAL = 'udid-1'

// The fake go-ios: prints its arguments, a syslog, an AFC tree and pulls files
var FAKE_GO_IOS = `#!/usr/bin/env node
var fs = require('fs')
var path = require('path')
var args = process.argv.slice(2)
var rest = args.filter(function(arg) { return !arg.startsWith('--udid=') })
var udid = args.filter(function(arg) { return arg.startsWith('--udid=') })
function option(name) {
  var arg = rest.find(function(arg) { return arg.startsWith(name + '=') })
  return arg ? arg.slice(name.length + 1) : null
}
if (rest[0] === 'syslog') {
  console.log(JSON.stringify({msg: 'Oct 19 17:02:46 iPhone SpringBoard[57] <Notice>: hello'}))
  console.log(JSON.stringify({msg: 'Oct 19 17:02:47 iPhone kernel[0] <Debug>: debug line'}))
  setInterval(function() {}, 1000)
}
else if (rest[0] === 'list') {
  var connection = process.env.FAKE_GO_IOS_CONNECTION || 'USB'
  console.log(JSON.stringify({deviceList: [{Udid: 'udid-1', ConnectionType: connection}]}))
}
else if (rest[0] === 'ps') {
  console.log('waiting')
  setInterval(function() {}, 1000)
}
else if (rest[0] === 'fsync' && rest.includes('tree')) {
  if (option('--path') === '/missing') {
    var error = {level: 'error', msg: 'fsync: tree view failed', err: 'not found'}
    console.error(JSON.stringify(error))
    process.exit(1)
  }
  process.stdout.write('|-DCIM/\\n|  |-100APPLE/\\n|  |  |-IMG_0001.JPG\\n|-notes.txt\\n')
}
else if (rest[0] === 'fsync' && rest.includes('pull')) {
  var src = option('--srcPath')
  fs.writeFileSync(path.join(option('--dstPath'), path.basename(src)), 'content of ' + src)
}
else {
  console.log(JSON.stringify({args: rest, udid: udid}))
  console.error(JSON.stringify({level: 'info', msg: 'done'}))
}
`

interface Decoded {
  channel: string
  type: string
  message: any
}

interface Unit {
  router: ReturnType<typeof wirerouter>
  group: EventEmitter
  subscribed: string[]
  stored: Array<{type: string, content: string, meta: Record<string, unknown>}>
  sent(): Decoded[]
  send(channel: string, message: {$code: number, encode(): Buffer}): void
  done(channel: string): Promise<Decoded>
}

async function loadPlugin(
  name: string
, deviceType = 'iPhone'
): Promise<{plugin: any, unit: Unit}> {
  var pushed: unknown[][] = []
  var router = wirerouter()
  var group = Object.assign(new EventEmitter(), {
    get: function() {
      return Bluebird.resolve({group: 'group-1'})
    }
  })
  var unit: Unit = {
    router: router
  , group: group
  , subscribed: []
  , stored: []
  , sent: function() {
      return pushed.map(function(message) {
        var envelope = wire.Envelope.decode(message[1] as Buffer)
        var type = wire.ReverseMessageType[envelope.type]!
        var decoder = wire[type] as unknown as {decode(body: unknown): unknown}
        return {channel: String(message[0]), type: type, message: decoder.decode(envelope.message)}
      })
    }
  , send: function(channel, message) {
      router.handler()(channel, wireutil.transaction(channel, message as never))
    }
  , done: async function(channel) {
      for (var i = 0; i < 250; i++) {
        var found = unit.sent().find(function(item) {
          return item.channel === channel && item.type === 'TransactionDoneMessage'
        })
        if (found) {
          return found
        }
        await new Promise(function(resolve) {
          setTimeout(resolve, 20)
        })
      }
      throw new Error('No answer on ' + channel)
    }
  }

  function module(file: string) {
    return new URL(file, lib)
  }

  var restores = [
    mockModule(module('util/lifecycle.js'), {default: {
      fatal: function() {}
    , observe: function() {}
    }})
  , mockModule(module('units/ios-device/support/push.js'), {
      default: syrup.serial().define(function() {
        return {
          send: function(message: unknown[]) {
            pushed.push(message)
          }
        }
      })
    })
  , mockModule(module('units/ios-device/support/router.js'), {
      default: syrup.serial().define(function() {
        return router
      })
    })
  , mockModule(module('units/ios-device/support/sub.js'), {
      default: syrup.serial().define(function() {
        return {
          subscribe: function(channel: string) {
            unit.subscribed.push(channel)
          }
        , unsubscribe: function(channel: string) {
            unit.subscribed = unit.subscribed.filter(function(item) {
              return item !== channel
            })
          }
        }
      })
    })
  , mockModule(module('units/ios-device/support/storage.js'), {
      default: syrup.serial().define(function() {
        return {
          store: function(type: string, stream: Readable, meta: Record<string, unknown>) {
            return new Bluebird(function(resolve, reject) {
              var content = ''
              stream.on('data', function(chunk: Buffer) {
                content += chunk.toString()
              })
              stream.on('error', reject)
              stream.on('end', function() {
                unit.stored.push({type: type, content: content, meta: meta})
                resolve({href: '/s/blob/stored/' + meta.filename})
              })
            })
          }
        }
      })
    })
  , mockModule(module('units/ios-device/plugins/wda/WdaClient.js'), {
      // WDA is not there, the radio plugin fails on its first request
      default: syrup.serial().define(function() {
        return {baseUrl: 'http://127.0.0.1:1', sessionId: 'stf-1', deviceType: deviceType}
      })
    })
  , mockModule(module('units/ios-device/plugins/group.js'), {
      default: syrup.serial().define(function() {
        return group
      })
    })
  ]
  try {
    var plugin = await (await importFresh(module('units/ios-device/plugins/' + name + '.js')))
      .default.consume({serial: SERIAL})
    return {plugin: plugin, unit: unit}
  }
  finally {
    restores.forEach(function(restore) {
      restore()
    })
  }
}

describe('zebrunner: ios-device go-ios plugins', function() {
  var bin: string
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

  describe('shell', function() {
    it('should run an allowed command on the device and send its output', async function() {
      var {unit} = await loadPlugin('shell')
      unit.send('tx-1', new wire.ShellCommandMessage('ios apps --list', 5000))
      var done = await unit.done('tx-1')
      expect(done.message.success).to.equal(true)

      var output = unit.sent()
        .filter(function(item) {
          return item.channel === 'tx-1' && item.type === 'TransactionProgressMessage'
        })
        .map(function(item) {
          return item.message.data
        })
        .join('')
      expect(output).to.include(JSON.stringify({
        args: ['apps', '--list']
      , udid: ['--udid=' + SERIAL]
      }))
      expect(output).to.include('"msg":"done"')
      expect(unit.subscribed).to.deep.equal([])
    })

    it('should refuse a command outside of the allow list without running it', async function() {
      var {unit} = await loadPlugin('shell')
      unit.send('tx-2', new wire.ShellCommandMessage('erase --force', 5000))
      var done = await unit.done('tx-2')
      expect(done.message.success).to.equal(false)
      expect(done.message.data).to.match(/The command "erase" is not allowed/)
      expect(unit.sent().filter(function(item) {
        return item.type === 'TransactionProgressMessage'
      })).to.have.length(0)
    })

    it('should stop a command that runs longer than its timeout', async function() {
      var {unit} = await loadPlugin('shell')
      var started = Date.now()
      unit.send('tx-3', new wire.ShellCommandMessage('ps', 300))
      var done = await unit.done('tx-3')
      expect(done.message.success).to.equal(true)
      expect(Date.now() - started).to.be.below(3000)
    })
  })

  describe('syslog', function() {
    it('should send the syslog to the group as logcat entries until it stops', async function() {
      var {plugin, unit} = await loadPlugin('devicelog')
      unit.send('tx-1', new wire.LogcatStartMessage([]))
      expect((await unit.done('tx-1')).message.success).to.equal(true)

      var entries: Decoded[] = []
      for (var i = 0; i < 100 && entries.length < 2; i++) {
        await new Promise(function(resolve) {
          setTimeout(resolve, 20)
        })
        entries = unit.sent().filter(function(item) {
          return item.type === 'DeviceLogcatEntryMessage'
        })
      }
      expect(entries.map(function(item) {
        return [item.channel, item.message.serial, item.message.pid, item.message.priority
          , item.message.tag, item.message.message]
      })).to.deep.equal([
        ['group-1', SERIAL, 57, 4, 'SpringBoard', 'hello']
      , ['group-1', SERIAL, 0, 3, 'kernel', 'debug line']
      ])
      expect(plugin.isRunning()).to.equal(true)

      unit.send('tx-2', new wire.LogcatStopMessage())
      expect((await unit.done('tx-2')).message.success).to.equal(true)
      expect(plugin.isRunning()).to.equal(false)
    })

    it('should apply the filters of logcat', async function() {
      var {plugin, unit} = await loadPlugin('devicelog')
      unit.send('tx-1', new wire.LogcatStartMessage([new wire.LogcatFilter('*', 4)]))
      await unit.done('tx-1')
      await new Promise(function(resolve) {
        setTimeout(resolve, 500)
      })
      expect(unit.sent().filter(function(item) {
        return item.type === 'DeviceLogcatEntryMessage'
      }).map(function(item) {
        return item.message.tag
      })).to.deep.equal(['SpringBoard'])
      await plugin.stop()
    })

    it('should stop when the device is released', async function() {
      var {plugin, unit} = await loadPlugin('devicelog')
      unit.send('tx-1', new wire.LogcatStartMessage([]))
      await unit.done('tx-1')
      unit.group.emit('leave', {group: 'group-1'})
      expect(plugin.isRunning()).to.equal(false)
    })
  })

  describe('filesystem', function() {
    it('should list a directory of the media of the device', async function() {
      var {unit} = await loadPlugin('filesystem')
      unit.send('tx-1', new wire.FileSystemListMessage('/'))
      var done = await unit.done('tx-1')
      expect(done.message.success).to.equal(true)
      expect(JSON.parse(done.message.body)).to.deep.equal([
        {name: 'DCIM', mode: 0o040000, size: -1}
      , {name: 'notes.txt', mode: 0o100000, size: -1}
      ])
    })

    it('should answer the error of go-ios', async function() {
      var {unit} = await loadPlugin('filesystem')
      unit.send('tx-1', new wire.FileSystemListMessage('/missing'))
      var done = await unit.done('tx-1')
      expect(done.message.success).to.equal(false)
      expect(done.message.data).to.equal('fsync: tree view failed: not found')
    })

    it('should store a file of the device and remove its local copy', async function() {
      var before = fs.readdirSync(os.tmpdir()).filter(function(name) {
        return name.startsWith('stf-afc-')
      })
      var {unit} = await loadPlugin('filesystem')
      unit.send('tx-1', new wire.FileSystemGetMessage('/DCIM/notes.txt'))
      var done = await unit.done('tx-1')
      expect(done.message.success).to.equal(true)
      expect(JSON.parse(done.message.body)).to.deep.equal({href: '/s/blob/stored/notes.txt'})
      expect(unit.stored).to.have.length(1)
      expect(unit.stored[0]!.type).to.equal('blob')
      expect(unit.stored[0]!.content).to.equal('content of /DCIM/notes.txt')
      expect(unit.stored[0]!.meta).to.include({filename: 'notes.txt', knownLength: 26})
      expect(fs.readdirSync(os.tmpdir()).filter(function(name) {
        return name.startsWith('stf-afc-')
      })).to.deep.equal(before)
    })

    it('should refuse a path out of the media directory', async function() {
      var {unit} = await loadPlugin('filesystem')
      unit.send('tx-1', new wire.FileSystemGetMessage('/DCIM/../../etc/passwd'))
      var done = await unit.done('tx-1')
      expect(done.message.success).to.equal(false)
      expect(done.message.data).to.match(/is not allowed/)
      expect(unit.stored).to.have.length(0)
    })
  })

  describe('radio', function() {
    afterEach(function() {
      delete process.env.FAKE_GO_IOS_CONNECTION
    })

    it('should not turn Wi-Fi off on a device reached over the network', async function() {
      process.env.FAKE_GO_IOS_CONNECTION = 'Network'
      var {unit} = await loadPlugin('radio')
      unit.send('tx-1', new wire.WifiSetEnabledMessage(false))
      var done = await unit.done('tx-1')
      expect(done.message.success).to.equal(false)
      expect(done.message.data).to.equal('Wi-Fi is turned off only on a device connected by USB')
    })

    it('should go on to Settings to turn Wi-Fi off on a device connected by USB', async function() {
      var {unit} = await loadPlugin('radio')
      unit.send('tx-1', new wire.WifiSetEnabledMessage(false))
      var done = await unit.done('tx-1')
      // the fake WDA is not there
      expect(done.message.success).to.equal(false)
      expect(done.message.data)
        .to.not.equal('Wi-Fi is turned off only on a device connected by USB')
    })

    it('should refuse what iOS and tvOS do not have', async function() {
      var {unit} = await loadPlugin('radio')
      unit.send('tx-1', new wire.RingerGetMessage())
      unit.send('tx-2', new wire.BluetoothCleanBondedMessage())
      expect((await unit.done('tx-1')).message.data).to.equal('Not supported on iOS')
      expect((await unit.done('tx-2')).message.data).to.equal('Not supported on iOS')

      var tv = (await loadPlugin('radio', 'Apple TV')).unit
      tv.send('tx-3', new wire.WifiGetStatusMessage())
      expect((await tv.done('tx-3')).message.data).to.equal('Not supported on tvOS')
    })
  })
})
