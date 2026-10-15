// Fork (Zebrunner): the wire messages of the fork, lib/wire/wire.proto
import {expect} from 'chai'

import wire from '../../../lib/wire/index.js'
import wireutil from '../../../lib/wire/util.js'

function roundTrip<T>(message: {$code: number, encode(): unknown}) {
  var envelope = wire.Envelope.decode(wireutil.envelope(message as never))
  var type = wire.ReverseMessageType[envelope.type]!
  var decoder = wire[type] as unknown as {decode(body: unknown): T}
  return {type: type, message: decoder.decode(envelope.message)}
}

describe('zebrunner: wire', function() {
  it('should keep the codes of the fork messages', function() {
    expect({
      TouchDownIosMessage: wire.MessageType.TouchDownIosMessage
    , TouchMoveIosMessage: wire.MessageType.TouchMoveIosMessage
    , BatteryIosEvent: wire.MessageType.BatteryIosEvent
    , SdkIosVersion: wire.MessageType.SdkIosVersion
    , DashboardOpenMessage: wire.MessageType.DashboardOpenMessage
    , TemporarilyUnavailableMessage: wire.MessageType.TemporarilyUnavailableMessage
    , InitializeIosDeviceState: wire.MessageType.InitializeIosDeviceState
    }).to.eql({
      TouchDownIosMessage: 98
    , TouchMoveIosMessage: 99
    , BatteryIosEvent: 113
    , SdkIosVersion: 114
    , DashboardOpenMessage: 116
    , TemporarilyUnavailableMessage: 120
    , InitializeIosDeviceState: 121
    })
  })

  it('should not give the retired fork codes to any message', function() {
    var retired = [20, 83, 84, 85, 97]
    for (var code = 100; code <= 125; code++) {
      retired.push(code)
    }
    var active = [113, 114, 116, 120, 121]
    retired.filter(function(code) {
      return active.indexOf(code) === -1
    }).forEach(function(code) {
      expect(wire.ReverseMessageType, String(code)).to.not.have.property(String(code))
    })
  })

  it('should keep the device statuses of the fork', function() {
    expect(wire.DeviceStatus.PREPARING).to.equal(6)
    expect(wire.DeviceStatus.UNHEALTHY).to.equal(7)
  })

  it('should carry the touches of an iOS device', function() {
    var down = roundTrip<{x: number, y: number}>(new wire.TouchDownIosMessage(0.25, 0.5))
    expect(down.type).to.equal('TouchDownIosMessage')
    expect(down.message.x).to.equal(0.25)
    expect(down.message.y).to.equal(0.5)

    var move = roundTrip<{toX: number, fromY: number, duration: number}>(
      new wire.TouchMoveIosMessage(0.75, 0.5, 0.25, 0.125, 0.5)
    )
    expect(move.type).to.equal('TouchMoveIosMessage')
    expect(move.message.toX).to.equal(0.75)
    expect(move.message.fromY).to.equal(0.125)
    expect(move.message.duration).to.equal(0.5)
  })

  it('should carry the initial state of an iOS device', function() {
    var state = roundTrip<{
      serial: string
      status: number
      provider: {channel: string, name: string, screenWsUrlPattern: string}
      ports: {screenPort: number, connectPort: number}
      options: {id: string, name: string, platform: string, architect: string}
    }>(new wire.InitializeIosDeviceState(
      'udid'
    , wire.DeviceStatus.ONLINE
    , new wire.ProviderIosMessage('channel', 'provider', 'wss://stf/d/host/udid/7404/')
    , new wire.IosDevicePorts(7404, 7405)
    , new wire.UpdateIosDevice('udid', 'iPhone 15', 'iOS', 'amd64')
    ))
    expect(state.type).to.equal('InitializeIosDeviceState')
    expect(state.message.serial).to.equal('udid')
    expect(state.message.status).to.equal(wire.DeviceStatus.ONLINE)
    expect(state.message.provider.screenWsUrlPattern).to.equal('wss://stf/d/host/udid/7404/')
    expect(state.message.ports.screenPort).to.equal(7404)
    expect(state.message.ports.connectPort).to.equal(7405)
    expect(state.message.options.name).to.equal('iPhone 15')
  })

  it('should carry the battery and the version of an iOS device', function() {
    var battery = roundTrip<{id: string, level: number, status: string}>(
      new wire.BatteryIosEvent('udid', 'good', 'usb', 'charging', 80, '30', 100)
    )
    expect(battery.type).to.equal('BatteryIosEvent')
    expect(battery.message.level).to.equal(80)
    expect(battery.message.status).to.equal('charging')

    var version = roundTrip<{sdkVersion: string}>(new wire.SdkIosVersion('udid', 'iPhone', '17.4'))
    expect(version.type).to.equal('SdkIosVersion')
    expect(version.message.sdkVersion).to.equal('17.4')
  })

  it('should carry the messages without a body', function() {
    expect(roundTrip(new wire.DashboardOpenMessage()).type).to.equal('DashboardOpenMessage')
    var unavailable = roundTrip<{serial: string}>(new wire.TemporarilyUnavailableMessage('udid'))
    expect(unavailable.type).to.equal('TemporarilyUnavailableMessage')
    expect(unavailable.message.serial).to.equal('udid')
  })
})
