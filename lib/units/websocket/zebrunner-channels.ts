// Fork (Zebrunner): the client of the websocket names the channel of the device it sends a command
// to, and a device runs every command of its channel: the channel of a device is
// base64(sha1(serial)), so any signed-in user controlled any device (shell, install, remote ADB,
// files, input), also the devices of the other users and of the automation of the grid. The
// commands go to the devices of the user only, the invitations to the devices the user may use,
// and the client subscribes to the channels of its transactions only (the devices publish their
// logs in the channel of the group of their owner).
import {reportDropped, type Log} from '../../util/zebrunner-guard.js'

// the channel of a transaction of the UI (res/app/src/core/transaction.ts)
export var TX_CHANNEL = /^tx\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// the events whose first argument is the channel of a device (or of the devices of the user),
// the websocket sends their message to it
export var DEVICE_EVENTS = new Set([
  'input.touchDown', 'input.touchMove', 'input.touchDownIos', 'input.touchMoveIos'
, 'input.touchPathIos', 'input.touchUp', 'input.touchCommit', 'input.touchReset'
, 'input.gestureStart', 'input.gestureStop', 'input.type', 'input.keyDown', 'input.keyUp'
, 'input.keyPress', 'display.rotate', 'clipboard.paste', 'clipboard.copy', 'device.identify'
, 'device.reboot', 'account.check', 'account.remove', 'account.addmenu', 'account.add'
, 'account.get', 'sd.status', 'ringer.set', 'ringer.get', 'wifi.set', 'wifi.get', 'bluetooth.set'
, 'bluetooth.get', 'bluetooth.cleanBonds', 'group.invite', 'group.kick', 'shell.command'
, 'shell.keepalive', 'device.install', 'device.uninstall', 'storage.upload', 'forward.test'
, 'forward.create', 'forward.remove', 'logcat.start', 'logcat.stop', 'connect.start'
, 'connect.stop', 'browser.open', 'browser.clear', 'store.open', 'settings.open'
, 'screen.capture', 'fs.retrieve', 'fs.list'
])

// the events whose second argument is the channel of the response, the websocket subscribes to it
export var RESPONSE_EVENTS = new Set([
  'clipboard.paste', 'clipboard.copy', 'device.identify', 'device.reboot', 'account.check'
, 'account.remove', 'account.addmenu', 'account.add', 'account.get', 'sd.status', 'ringer.set'
, 'ringer.get', 'wifi.set', 'wifi.get', 'bluetooth.set', 'bluetooth.get', 'bluetooth.cleanBonds'
, 'group.invite', 'group.kick', 'shell.command', 'device.install', 'device.uninstall'
, 'storage.upload', 'forward.test', 'forward.create', 'forward.remove', 'logcat.start'
, 'logcat.stop', 'connect.start', 'connect.stop', 'browser.open', 'browser.clear', 'store.open'
, 'screen.capture', 'fs.retrieve', 'fs.list'
])

// the events whose first argument is the channel of a transaction, the websocket subscribes to it
export var TRANSACTION_EVENTS = new Set(['tx.punch', 'tx.cleanup'])

export interface ChannelUser {
  email: string
  privilege: string
  // the private channel of the group of the user: all the devices of the user listen to it
  group: string
}

export interface ChannelDb {
  // the channels of the present devices the user uses now
  ownedDeviceChannels(email: string): PromiseLike<string[]>
  // whether the device of the channel is in a group of the user
  visibleDeviceChannel(email: string, channel: string): PromiseLike<boolean>
}

// the devices of the user are loaded again after this time: a released device gets no command
// later than this
var OWNED_TTL_MS = 2000
// a channel that is not of the devices of the user loads them again, not more often than this: a
// device the user has just taken gets its commands, a client cannot load the database in a loop
var MIN_RELOAD_MS = 250

type Packet = [string, ...unknown[]]

/**
 * The middleware of the socket of a client (socket.use): a message to a channel the user may not
 * use is logged and dropped. The messages of the client are checked one after another, in their
 * order: the order of the input events matters.
 */
export function channelGuard(
  log: Log
, user: ChannelUser
, db: ChannelDb
, now: () => number = Date.now
) {
  var owned = new Set<string>()
  var loadedAt = -Infinity
  var queue: Promise<unknown> = Promise.resolve()

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function loadOwned() {
    owned = new Set(await db.ownedDeviceChannels(user.email))
    loadedAt = now()
  }

  async function owns(channel: string) {
    if (channel === user.group) {
      return true
    }
    if (now() - loadedAt > OWNED_TTL_MS) {
      await loadOwned()
    }
    if (!owned.has(channel)) {
      var wait = MIN_RELOAD_MS - (now() - loadedAt)
      if (wait > 0) {
        await sleep(wait)
      }
      await loadOwned()
    }
    return owned.has(channel)
  }

  function isTransaction(channel: unknown) {
    return typeof channel === 'string' && TX_CHANNEL.test(channel)
  }

  // the reason the message is refused, null when it is allowed
  async function refusal(event: string, args: unknown[]): Promise<string | null> {
    if (TRANSACTION_EVENTS.has(event)) {
      return isTransaction(args[0]) ? null : 'the channel is not the one of a transaction'
    }
    if (RESPONSE_EVENTS.has(event) && !isTransaction(args[1])) {
      return 'the response channel is not the one of a transaction'
    }
    if (!DEVICE_EVENTS.has(event)) {
      return null
    }
    var channel = args[0]
    if (typeof channel !== 'string' || !channel) {
      return 'no channel'
    }
    if (user.privilege === 'admin') {
      return null
    }
    if (event === 'group.invite') {
      return await db.visibleDeviceChannel(user.email, channel) ?
        null :
        'the channel is not the one of a device of the groups of the user'
    }
    return await owns(channel) ? null : 'the channel is not the one of a device the user uses'
  }

  var middleware = function(packet: Packet, next: (err?: Error) => void) {
    var [event, ...args] = packet
    var what = `the "${event}" event of a client`
    queue = queue
      .then(() => refusal(event, args))
      .then(function(reason) {
        if (reason !== null) {
          reportDropped(log, what, new Error(`Refused: ${reason}`), user.email)
          return
        }
        next()
      }, function(err: unknown) {
        reportDropped(log, what, err, user.email)
      })
  }
  return Object.assign(middleware, {
    // the packets received so far are checked (tests)
    drained() {
      return queue.then(() => {})
    }
  })
}
