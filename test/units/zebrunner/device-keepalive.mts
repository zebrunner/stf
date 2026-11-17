// Fork (Zebrunner): POST /user/devices/{serial}/keepalive, keepUserDeviceBySerial of
// lib/units/api/controllers/zebrunner.ts, with the database stubbed and the ZeroMQ sockets faked
import {EventEmitter} from 'node:events'

import {expect} from 'chai'
import sinon from 'sinon'

import wire from '../../../lib/wire/index.js'
import wireutil from '../../../lib/wire/util.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

interface Reply {
  code: number
  body: any
}

var dbapi = {
  loadDeviceBySerial: sinon.stub()
}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: dbapi})
var zebrunner = await importFresh(
  new URL('../../../lib/units/api/controllers/zebrunner.js', import.meta.url)
)
restoreDbApi()
restoreDb()

var USER = {email: 'john@example.com', privilege: 'user'}
var OWNER = {email: 'john@example.com', name: 'John', group: 'john-group'}

function device(fields: object = {}) {
  return Object.assign({
    serial: 'serial'
  , channel: 'device-channel'
  , present: true
  , owner: OWNER
  , usage: 'automation'
  }, fields)
}

interface Sent {
  channel: string
  envelope: any
  message: any
}

interface Context {
  sent: Sent[]
  subscribed: string[]
  channelRouter: EventEmitter
  reply: Promise<Reply>
}

// keep <user> [answer]: calls the route; answer(sent) answers the message the device got, as the
// device would
function keep(user: object, answer?: (sent: Sent, context: Context) => void): Context {
  var sent: Sent[] = []
  var subscribed: string[] = []
  var channelRouter = new EventEmitter()
  var context = {sent: sent, subscribed: subscribed, channelRouter: channelRouter} as Context
  context.reply = new Promise<Reply>(function(resolve) {
    var reply: Reply = {code: 200, body: null}
    var res = {
      status: function(code: number) {
        reply.code = code
        return res
      }
    , json: function(body: unknown) {
        reply.body = body
        resolve(reply)
        return res
      }
    }
    var req = {
      swagger: {params: {serial: {value: 'serial'}}}
    , user: user
    , options: {
        sub: {
          subscribe: function(channel: string) {
            subscribed.push(channel)
          }
        , unsubscribe: function(channel: string) {
            subscribed.splice(subscribed.indexOf(channel), 1)
          }
        }
      , push: {
          send: function(frames: [string, Buffer]) {
            var envelope = wire.Envelope.decode(frames[1])
            var item = {
              channel: frames[0]
            , envelope: envelope
            , message: wire.GroupMessage.decode(envelope.message)
            }
            sent.push(item)
            if (answer) {
              setImmediate(function() {
                answer(item, context)
              })
            }
          }
        }
      , channelRouter: channelRouter
      }
    }
    zebrunner.keepUserDeviceBySerial(req, res)
  })
  return context
}

function answerWith(success: boolean) {
  return function(item: Sent, context: Context) {
    var reply = wireutil.reply('serial')
    context.channelRouter.emit(item.envelope.channel, item.envelope.channel
    , success ? reply.okay() : reply.fail('Already grouped'))
  }
}

describe('zebrunner: keepalive of a reservation', function() {
  beforeEach(function() {
    dbapi.loadDeviceBySerial.reset()
    dbapi.loadDeviceBySerial.resolves(device())
  })

  it('should send the device the group of its owner again on its channel', async function() {
    var context = keep(USER, answerWith(true))
    var reply = await context.reply
    expect(reply).to.eql({
      code: 200
    , body: {success: true, description: 'The reservation of the device is kept'}
    })
    expect(context.sent).to.have.length(1)
    var item = context.sent[0]!
    expect(item.channel).to.equal('device-channel')
    expect(item.envelope.channel).to.match(/^txn_/)
    expect(item.message.owner).to.include(OWNER)
    expect(item.message.usage).to.equal('automation')
    expect(item.message.requirements[0].name).to.equal('serial')
    expect(item.message.requirements[0].value).to.equal('serial')
    expect(context.subscribed).to.eql([])
    expect(context.channelRouter.listenerCount(item.envelope.channel)).to.equal(0)
  })

  it('should answer 403 when the device left the group of the user meanwhile', async function() {
    var reply = await keep(USER, answerWith(false)).reply
    expect(reply.code).to.equal(403)
  })

  it('should refuse the device of another user, an absent one and a free one', async function() {
    var other = {email: 'mary@example.com', name: 'Mary', group: 'mary-group'}
    for (var fields of [{owner: other}, {present: false}, {owner: null}]) {
      dbapi.loadDeviceBySerial.resolves(device(fields))
      var context = keep(USER)
      expect((await context.reply).code, JSON.stringify(fields)).to.equal(403)
      expect(context.sent).to.have.length(0)
    }
    // not for an admin either: the grid keeps the devices with the token of their user
    dbapi.loadDeviceBySerial.resolves(device({owner: other}))
    expect((await keep({email: 'admin@example.com', privilege: 'admin'}).reply).code).to.equal(403)
  })

  it('should answer 404 for an unknown device and 500 for an error', async function() {
    dbapi.loadDeviceBySerial.resolves(null)
    expect((await keep(USER).reply).code).to.equal(404)
    dbapi.loadDeviceBySerial.rejects(new Error('db'))
    expect((await keep(USER).reply).code).to.equal(500)
  })

  it('should answer 504 when the device does not answer', async function() {
    var clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    try {
      var context = keep(USER)
      await Promise.resolve()
      await Promise.resolve()
      clock.tick(zebrunner.KEEPALIVE_TIMEOUT_MS)
      var reply = await context.reply
      expect(reply.code).to.equal(504)
      expect(context.subscribed).to.eql([])
    }
    finally {
      clock.restore()
    }
  })
})
