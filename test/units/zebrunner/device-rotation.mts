// Fork (Zebrunner): the rotation of an Android device (#808). STFService thaws an unlocked
// rotation right after it sets it, so the service plugin always locks the rotation of the user
// (service.ts) and the group plugin turns the device back to portrait, with the auto-rotate
// setting of before, when it is released (group.ts). The agent socket of STFService is a stream
// here, the requests are decoded with the proto of STFService
import events from 'node:events'
import {PassThrough} from 'node:stream'

import {expect} from 'chai'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import wire from '../../../lib/wire/index.js'
import ms from '../../../lib/wire/messagestream.js'
import protobuf from '../../../lib/wire/protobuf.js'
import pathutil from '../../../lib/util/pathutil.js'
import devutil from '../../../lib/util/devutil.js'
import lifecycle from '../../../lib/util/lifecycle.js'
import service from '../../../lib/units/device/plugins/service.js'
import group from '../../../lib/units/device/plugins/group.js'
import type {GroupPlugin, ServicePlugin} from '../../../lib/types/device-plugins.js'

type Handler = (channel: string, message: unknown) => unknown

var apkWire = (protobuf.build(protobuf.load(pathutil.module(
  '@devicefarmer/stfservice-prebuilt/prebuilt/noarch/wire.proto'
))) as any).jp.co.cyberagent.stf.proto

// startService: the service plugin with a device whose agent socket is `agent` and whose
// auto-rotate setting is `autoRotate`; resolves with the plugin, the SetRotationRequest messages
// the agent got and the commands of the adb shell
async function startService(handlers: Record<number, Handler>, autoRotate = '0') {
  var agent = new PassThrough()
  var rotations: Array<{rotation: number, lock: boolean}> = []
  var commands: string[] = []
  agent.pipe(new ms.DelimitedStream()).on('data', function(data: Buffer) {
    var envelope = apkWire.Envelope.decode(data)
    if (envelope.type === apkWire.MessageType.SET_ROTATION) {
      var request = apkWire.SetRotationRequest.decode(envelope.message)
      rotations.push({rotation: request.rotation, lock: request.lock})
    }
  })
  sinon.stub(devutil, 'killProcsByComm').returns(Bluebird.resolve() as any)
  sinon.stub(devutil, 'ensureUnusedLocalSocket').returns(Bluebird.resolve() as any)
  sinon.stub(devutil, 'waitForLocalSocket').callsFake(
    function(adb: unknown, serial: string, sock: string) {
      return Bluebird.resolve(sock === 'localabstract:stfagent' ? agent : new PassThrough()) as any
    }
  )
  var adb = {
    shell: function(serial: string, command: string) {
      var out = new PassThrough()
      if (typeof command === 'string' && command.indexOf('settings') === 0) {
        commands.push(command)
        if (command === 'settings get system accelerometer_rotation') {
          out.write(autoRotate + '\n')
        }
      }
      out.end()
      return Bluebird.resolve(out)
    }
  }
  var router = {
    on: function(type: {$code: number}, handler: Handler) {
      handlers[type.$code] = handler
      return router
    }
  }
  var apk = {
    path: '/data/app/stf.apk'
  , main: 'jp.co.cyberagent.stf.Agent'
  , startIntent: {action: 'action', component: 'component'}
  , wire: apkWire
  }
  var plugin = await service.invoke(
    {serial: 'test-device'}
  , adb
  , router
  , {send: sinon.spy()}
  , {level: 31}
  , apk
  ) as ServicePlugin
  return {plugin: plugin, rotations: rotations, commands: commands}
}

function flush() {
  return new Promise(function(resolve) {
    setTimeout(resolve, 20)
  })
}

describe('Device rotation', function() {
  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
  })

  afterEach(function() {
    sinon.restore()
  })

  it('should lock the rotation of the user', async function() {
    var handlers: Record<number, Handler> = {}
    var context = await startService(handlers)

    handlers[wire.RotateMessage.$code]!('channel', new wire.RotateMessage(90))
    await flush()

    expect(context.rotations).to.eql([{rotation: 90, lock: true}])
    expect(context.plugin.isRotated()).to.equal(true)
  })

  it('should read the auto-rotate setting once and keep the order of the rotations',
    async function() {
      var handlers: Record<number, Handler> = {}
      var context = await startService(handlers)

      context.plugin.rotate(90)
      context.plugin.rotate(270)
      context.plugin.rotate(0)
      await flush()

      expect(context.rotations).to.eql([
        {rotation: 90, lock: true}
      , {rotation: 270, lock: true}
      , {rotation: 0, lock: true}
      ])
      expect(context.commands).to.eql(['settings get system accelerometer_rotation'])
    })

  it('should reset to a locked portrait and turn auto-rotate back on', async function() {
    this.timeout(5000)
    var handlers: Record<number, Handler> = {}
    var context = await startService(handlers, '1')

    context.plugin.rotate(90)
    await context.plugin.resetRotation()

    expect(context.rotations).to.eql([{rotation: 90, lock: true}, {rotation: 0, lock: true}])
    expect(context.commands).to.eql([
      'settings get system accelerometer_rotation'
    , 'settings put system accelerometer_rotation 1'
    ])
    expect(context.plugin.isRotated()).to.equal(false)
  })

  it('should reset to a locked portrait when auto-rotate was off', async function() {
    var handlers: Record<number, Handler> = {}
    var context = await startService(handlers, '0')

    context.plugin.rotate(90)
    await context.plugin.resetRotation()

    expect(context.rotations).to.eql([{rotation: 90, lock: true}, {rotation: 0, lock: true}])
    expect(context.commands).to.eql(['settings get system accelerometer_rotation'])
  })
})

describe('Device release', function() {
  function setup(screenReset: boolean, rotated: boolean) {
    var handlers: Record<number, Handler> = {}
    var router = {
      on: function(type: {$code: number}, handler: Handler) {
        handlers[type.$code] = handler
        return router
      }
    }
    var channels = Object.assign(new events.EventEmitter(), {
      register: sinon.spy()
    , unregister: sinon.spy()
    })
    var servicePlugin = {
      wake: sinon.spy()
    , acquireWakeLock: sinon.spy()
    , releaseWakeLock: sinon.spy()
    , pressKey: sinon.spy()
    , thawRotation: sinon.spy()
    , resetRotation: sinon.spy()
    , isRotated: sinon.stub().returns(rotated)
    }
    var plugin = group.invoke(
      {serial: 'test-device', groupTimeout: 1000, screenReset: screenReset}
    , {channel: 'solo-channel'}
    , {}
    , servicePlugin
    , router
    , {send: sinon.spy()}
    , {subscribe: sinon.spy(), unsubscribe: sinon.spy()}
    , channels
    ) as GroupPlugin
    var owner = new wire.OwnerMessage('a@example.com', 'a', 'group-channel')
    return Bluebird.resolve(plugin.join(owner, 1000, null))
      .then(function() {
        return plugin.leave('ungroup_request')
      })
      .then(function() {
        return servicePlugin
      })
  }

  beforeEach(function() {
    sinon.stub(lifecycle, 'observe')
  })

  afterEach(function() {
    sinon.restore()
  })

  it('should turn a rotated device back to portrait without the home screen', async function() {
    var servicePlugin = await setup(false, true)

    expect(servicePlugin.resetRotation.calledOnce).to.equal(true)
    expect(servicePlugin.thawRotation.called).to.equal(false)
    expect(servicePlugin.pressKey.called).to.equal(false)
  })

  it('should leave a device that was not rotated as it is', async function() {
    var servicePlugin = await setup(false, false)

    expect(servicePlugin.resetRotation.called).to.equal(false)
    expect(servicePlugin.thawRotation.called).to.equal(false)
    expect(servicePlugin.pressKey.called).to.equal(false)
  })

  it('should keep the screen reset of upstream', async function() {
    var servicePlugin = await setup(true, false)

    expect(servicePlugin.pressKey.calledWith('home')).to.equal(true)
    expect(servicePlugin.thawRotation.calledOnce).to.equal(true)
    expect(servicePlugin.resetRotation.called).to.equal(false)
  })

  it('should reset a rotated device with the screen reset', async function() {
    var servicePlugin = await setup(true, true)

    expect(servicePlugin.pressKey.calledWith('home')).to.equal(true)
    expect(servicePlugin.resetRotation.calledOnce).to.equal(true)
    expect(servicePlugin.thawRotation.called).to.equal(false)
  })
})
