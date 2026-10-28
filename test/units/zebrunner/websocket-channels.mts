// Fork (Zebrunner): the client of the websocket sends to the channels of its devices only,
// lib/units/websocket/zebrunner-channels.ts
import {expect} from 'chai'
import fs from 'fs'
import http from 'http'
import type {AddressInfo} from 'net'
import {Server} from 'socket.io'
import {io as connect} from 'socket.io-client'

import {
  DEVICE_EVENTS, RESPONSE_EVENTS, TRANSACTION_EVENTS, TX_CHANNEL, channelGuard, type ChannelDb
} from '../../../lib/units/websocket/zebrunner-channels.js'
import {guardSocket, resetReported} from '../../../lib/util/zebrunner-guard.js'
import type DbApi from '../../../lib/db/api.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var TX = 'tx.0f8fad5b-d9cb-469f-a165-70867728950e'
var MINE = 'mine/device+channel='
var OTHER = 'other/device+channel='
var USER = {email: 'user@example.com', privilege: 'user', group: 'private-group-of-the-user'}

interface FakeDb extends ChannelDb {
  owned: string[]
  visible: string[]
  ownedLoads: number
  delay: number
}

function fakeDb(): FakeDb {
  var db: FakeDb = {
    owned: [MINE]
  , visible: [MINE, OTHER]
  , ownedLoads: 0
  , delay: 0
  , ownedDeviceChannels() {
      db.ownedLoads++
      var owned = [...db.owned]
      return new Promise((resolve) => setTimeout(() => resolve(owned), db.delay))
    }
  , visibleDeviceChannel(_email, channel) {
      return Promise.resolve(db.visible.includes(channel))
    }
  }
  return db
}

// send: the packets through the guard; passed: the ones it let through, in their order
function guard(db: ChannelDb, user = USER, now: () => number = Date.now) {
  var errors: string[] = []
  var log = {
    error(...args: unknown[]) {
      var [format, ...values] = args as [string, ...unknown[]]
      errors.push(format.replace(/%s/g, () => String(values.shift())))
    }
  }
  var middleware = channelGuard(log, user, db, now)
  var passed: string[] = []
  return {
    errors
  , passed
  , send(...packets: [string, ...unknown[]][]) {
      packets.forEach(function(packet) {
        middleware(packet, () => passed.push(packet[0] + ' ' + String(packet[1])))
      })
      return middleware.drained()
    }
  }
}

describe('zebrunner: websocket channels', function() {
  beforeEach(function() {
    resetReported()
  })

  it('should classify every client event of the websocket', function() {
    // the events of WebsocketClientEvents in lib/units/websocket/index.ts: a new upstream event must be
    // classified here
    var file = new URL('../../../lib/units/websocket/index.ts', import.meta.url)
    var source = fs.readFileSync(file, 'utf8')
    var body = /interface WebsocketClientEvents \{([\s\S]*?)\n\}/.exec(source)![1]!
    var events = [...body.matchAll(/^\s+'([^']+)': (.+)$/gm)]
      .map((match): [string, string] => [match[1]!, match[2]!])
    var transactionType = /^(TransactionEvent|TransactionDataEvent)/
    var device = events.filter(([, type]) =>
      /^ChannelEvent/.test(type) || transactionType.test(type))
    var response = events.filter(([, type]) => transactionType.test(type))
    var transaction = events.filter(([, type]) => type === '(channel: string) => void')

    expect(events.length).to.be.greaterThan(60)
    expect([...DEVICE_EVENTS].sort()).to.eql(device.map(([name]) => name).sort())
    expect([...RESPONSE_EVENTS].sort()).to.eql(response.map(([name]) => name).sort())
    expect([...TRANSACTION_EVENTS].sort()).to.eql(transaction.map(([name]) => name).sort())
  })

  it('should know the transaction channels of the UI', function() {
    expect(TX_CHANNEL.test(TX)).to.equal(true)
    expect(TX_CHANNEL.test('tx.')).to.equal(false)
    expect(TX_CHANNEL.test(USER.group)).to.equal(false)
    expect(TX_CHANNEL.test(TX + 'x')).to.equal(false)
  })

  it('should let the events without a device channel through', async function() {
    var g = guard(fakeDb())
    await g.send(['device.note', {serial: 's', note: 'n'}], ['user.settings.update', {}])
    expect(g.passed).to.have.length(2)
  })

  it('should send the commands to the devices of the user only', async function() {
    var g = guard(fakeDb())
    await g.send(
      ['input.touchDown', MINE, {seq: 1}]
    , ['input.touchDown', OTHER, {seq: 1}]
    , ['shell.command', MINE, TX, {command: 'id'}]
    , ['connect.start', OTHER, TX]
    , ['group.kick', OTHER, TX, {requirements: {}}]
    , ['input.keyDown', USER.group, {key: 'home'}]
    , ['input.touchDown', 7, {seq: 1}]
    )
    expect(g.passed).to.eql([
      `input.touchDown ${MINE}`, `shell.command ${MINE}`, `input.keyDown ${USER.group}`
    ])
    expect(g.errors.join('\n')).to.contain(
      'Dropped the "input.touchDown" event of a client (user@example.com): Error: Refused:'
    )
  })

  it('should let an admin send to any device', async function() {
    var g = guard(fakeDb(), {...USER, privilege: 'admin'})
    await g.send(['input.touchDown', OTHER, {seq: 1}], ['group.kick', OTHER, TX, {}])
    expect(g.passed).to.have.length(2)
  })

  it('should invite the devices of the groups of the user only', async function() {
    var db = fakeDb()
    db.visible = [MINE]
    var g = guard(db)
    await g.send(['group.invite', MINE, TX, {}], ['group.invite', OTHER, TX, {}])
    expect(g.passed).to.eql([`group.invite ${MINE}`])
  })

  it('should subscribe the client to the channels of its transactions only', async function() {
    var g = guard(fakeDb())
    await g.send(
      ['tx.punch', TX]
    , ['tx.punch', 'private-group-of-another-user']
    , ['tx.cleanup', TX]
    , ['shell.command', MINE, 'private-group-of-another-user', {command: 'id'}]
    )
    expect(g.passed).to.eql([`tx.punch ${TX}`, `tx.cleanup ${TX}`])
  })

  it('should keep the order of the events while the devices are loaded', async function() {
    var db = fakeDb()
    db.delay = 50
    var g = guard(db)
    await g.send(
      ['input.touchDown', MINE, {seq: 1}]
    , ['input.touchMove', MINE, {seq: 2}]
    , ['input.touchUp', MINE, {seq: 3}]
    , ['input.touchCommit', MINE, {seq: 4}]
    )
    expect(g.passed.map((line) => line.split(' ')[0])).to.eql([
      'input.touchDown', 'input.touchMove', 'input.touchUp', 'input.touchCommit'
    ])
    expect(db.ownedLoads).to.equal(1)
  })

  it('should stop the commands to a released device, pass the ones to a new one', async function() {
    var clock = 0
    var db = fakeDb()
    var g = guard(db, USER, () => clock)
    await g.send(['input.touchDown', MINE, {seq: 1}])

    // released: the devices of the user are loaded again after 2 s
    db.owned = []
    clock = 1000
    await g.send(['input.touchDown', MINE, {seq: 2}])
    clock = 2500
    await g.send(['input.touchDown', MINE, {seq: 3}])
    expect(g.passed).to.eql([`input.touchDown ${MINE}`, `input.touchDown ${MINE}`])

    // taken just now: a channel that is not of the devices of the user loads them again
    db.owned = [OTHER]
    clock = 2600
    await g.send(['input.touchDown', OTHER, {seq: 4}])
    expect(g.passed).to.have.length(3)
  })

  it('should drop the events when the devices of the user cannot be loaded', async function() {
    var g = guard({
      ownedDeviceChannels: () => Promise.reject(new Error('database is down'))
    , visibleDeviceChannel: () => Promise.resolve(true)
    })
    await g.send(['input.touchDown', MINE, {seq: 1}], ['device.note', {}])
    expect(g.passed).to.eql(['device.note [object Object]'])
    expect(g.errors.join('\n')).to.contain('database is down')
  })

  describe('socket.io', function() {
    var server: http.Server, io: Server
    var received: string[] = []

    before(async function() {
      server = http.createServer()
      io = new Server(server)
      io.on('connection', function(socket) {
        var log = {error() {}}
        guardSocket(log, socket, () => USER.email)
        socket.use(channelGuard(log, USER, fakeDb()) as Parameters<typeof socket.use>[0])
        socket.on('input.touchDown', function(channel: string) {
          received.push(channel)
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    })

    after(async function() {
      io.close()
      await new Promise((resolve) => server.close(resolve))
    })

    it('should drop the commands to another device', async function() {
      var url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      var client = connect(url, {transports: ['websocket']})
      try {
        await new Promise<void>((resolve) => client.on('connect', () => resolve()))
        client.emit('input.touchDown', OTHER, {seq: 1})
        client.emit('input.touchDown', MINE, {seq: 2})
        var until = Date.now() + 5000
        while (!received.length && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(received).to.eql([MINE])
      }
      finally {
        client.close()
      }
    })
  })

  describe('database', function() {
    var queries: string[] = []
    var results: unknown[] = []
    var dbapi: typeof DbApi

    before(async function() {
      var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {
        run: function(query: {build(): unknown}) {
          queries.push(JSON.stringify(query.build()))
          return Promise.resolve(results.shift())
        }
      }})
      dbapi = (await importFresh(new URL('../../../lib/db/api.js', import.meta.url))).default
      restoreDb()
    })

    beforeEach(function() {
      queries = []
      results = []
    })

    it('should load the channels of the devices of the user by the owner index', async function() {
      results = [{toArray: () => Promise.resolve([MINE, null])}]
      expect(await dbapi.ownedDeviceChannels(USER.email)).to.eql([MINE])
      expect(queries[0]).to.contain('"owner"').and.contain(USER.email).and.contain('"channel"')
    })

    it('should check the device of the channel in the groups of the user', async function() {
      results = [{email: USER.email, groups: {subscribed: ['group-1']}}, 1]
      expect(await dbapi.visibleDeviceChannel(USER.email, OTHER)).to.equal(true)
      expect(queries[1]).to.contain(OTHER).and.contain('group-1')

      results = [{email: USER.email, groups: {subscribed: ['group-1']}}, 0]
      expect(await dbapi.visibleDeviceChannel(USER.email, OTHER)).to.equal(false)

      results = [null]
      expect(await dbapi.visibleDeviceChannel('unknown@example.com', OTHER)).to.equal(false)
    })
  })
})
