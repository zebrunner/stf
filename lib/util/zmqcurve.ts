/**
* Fork (Zebrunner): CURVE security of the ZeroMQ sockets (http://curvezmq.org). The messages of the
* units and of the device providers are encrypted, and the triproxies accept only the clients whose
* keys they know.
*
* The keys are hex strings of 32 bytes (64 characters), `stf curve-keygen` prints them:
* - STF_ZMQ_CURVE_SERVER_SECRET_KEY: the bound tcp sockets (the triproxies) are CURVE servers with
*   this key. A ZAP handler (RFC 27) lets in only the public keys of STF_ZMQ_CURVE_CLIENT_KEYS
*   (separated by commas or spaces) and the key of the unit itself; without the handler libzmq
*   refuses every client (ZAP_ENFORCE_DOMAIN), it does not let them in.
* - STF_ZMQ_CURVE_SERVER_PUBLIC_KEY and STF_ZMQ_CURVE_SECRET_KEY: the connecting tcp sockets are
*   CURVE clients of that server with this secret key; its public key is derived from it.
* Without these variables the sockets have no security, as in upstream.
**/

import crypto from 'crypto'

import * as zmq from 'zeromq'

import lifecycle from './lifecycle.js'
import logger from './logger.js'

const log = logger.createLogger('util:zmqcurve')

const KEY = /^[0-9a-f]{64}$/i
// The DER prefixes of the X25519 keys, followed by the 32 bytes of the key
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const ZAP_ENDPOINT = 'inproc://zeromq.zap.01'
const ZAP_DOMAIN = 'stf'
// A refused address is logged once in this time, not on every reconnect of its client
const DENIED_LOG_INTERVAL = 60 * 1000

export interface CurveKeyPair {
  publicKey: string
  secretKey: string
}

export interface CurveConfig {
  server?: {
    secretKey: Buffer
    // the hex public keys of the allowed clients
    clients: Set<string>
  }
  client?: {
    serverKey: Buffer
    publicKey: Buffer
    secretKey: Buffer
  }
}

// The part of the compat sockets of zeromq this module needs
interface CompatSocket {
  bind(address: string, callback?: (err?: Error) => void): unknown
  bindSync(address: string): unknown
  connect(address: string): unknown
}

function parseKey(name: string, value: string): Buffer {
  if (!KEY.test(value)) {
    throw new Error(`${name} must be a key of 64 hex characters (stf curve-keygen)`)
  }
  return Buffer.from(value, 'hex')
}

const Z85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#'

// The Z85 text of a key (ZMQ RFC 32), the form the socket options of zeromq take
export function z85(key: Buffer): string {
  let result = ''
  for (let offset = 0; offset < key.length; offset += 4) {
    let value = key.readUInt32BE(offset)
    let chunk = ''
    for (let i = 0; i < 5; i++) {
      chunk = Z85[value % 85] + chunk
      value = Math.floor(value / 85)
    }
    result += chunk
  }
  return result
}

export function publicKeyOf(secretKey: Buffer): Buffer {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_X25519, secretKey])
  , format: 'der'
  , type: 'pkcs8'
  })
  return crypto.createPublicKey(privateKey).export({format: 'der', type: 'spki'}).subarray(-32)
}

export function generateKeyPair(secretKey?: string): CurveKeyPair {
  let secret: Buffer
  if (typeof secretKey === 'undefined') {
    // eslint-disable-next-line no-sync
    const {privateKey} = crypto.generateKeyPairSync('x25519')
    secret = privateKey.export({format: 'der', type: 'pkcs8'}).subarray(-32)
  }
  else {
    secret = parseKey('The secret key', secretKey)
  }
  return {
    publicKey: publicKeyOf(secret).toString('hex')
  , secretKey: secret.toString('hex')
  }
}

// The configuration of the variables, an error for an incomplete or invalid one
export function config(env: NodeJS.ProcessEnv = process.env): CurveConfig {
  const result: CurveConfig = {}
  const own = env.STF_ZMQ_CURVE_SECRET_KEY ?
    parseKey('STF_ZMQ_CURVE_SECRET_KEY', env.STF_ZMQ_CURVE_SECRET_KEY) :
    null

  if (env.STF_ZMQ_CURVE_SERVER_SECRET_KEY) {
    const clients = new Set((env.STF_ZMQ_CURVE_CLIENT_KEYS || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(function(key) {
        return parseKey('STF_ZMQ_CURVE_CLIENT_KEYS', key).toString('hex')
      }))
    if (own) {
      clients.add(publicKeyOf(own).toString('hex'))
    }
    if (!clients.size) {
      throw new Error('STF_ZMQ_CURVE_SERVER_SECRET_KEY needs the keys of the clients: ' +
        'STF_ZMQ_CURVE_CLIENT_KEYS or STF_ZMQ_CURVE_SECRET_KEY')
    }
    result.server = {
      secretKey: parseKey('STF_ZMQ_CURVE_SERVER_SECRET_KEY', env.STF_ZMQ_CURVE_SERVER_SECRET_KEY)
    , clients: clients
    }
  }

  if (env.STF_ZMQ_CURVE_SERVER_PUBLIC_KEY) {
    if (!own) {
      throw new Error('STF_ZMQ_CURVE_SERVER_PUBLIC_KEY needs STF_ZMQ_CURVE_SECRET_KEY, ' +
        'the key of the client')
    }
    result.client = {
      serverKey: parseKey('STF_ZMQ_CURVE_SERVER_PUBLIC_KEY', env.STF_ZMQ_CURVE_SERVER_PUBLIC_KEY)
    , publicKey: publicKeyOf(own)
    , secretKey: own
    }
  }
  else if (own && !result.server) {
    throw new Error('STF_ZMQ_CURVE_SECRET_KEY needs STF_ZMQ_CURVE_SERVER_PUBLIC_KEY, ' +
      'the key of the server')
  }

  return result
}

let current: CurveConfig | null = null

function currentConfig(): CurveConfig {
  if (!current) {
    current = config()
    if (current.server) {
      log.info('CURVE server: %d client keys are allowed', current.server.clients.size)
    }
    if (current.client) {
      log.info('CURVE client with the public key %s', current.client.publicKey.toString('hex'))
    }
  }
  return current
}

// The ZAP handler of the process: one for all the CURVE servers, as libzmq asks the single
// inproc://zeromq.zap.01 endpoint of the context
let zapHandler: zmq.Router | null = null
let allowedClients = new Set<string>()
const deniedLogged = new Map<string, number>()

function logDenied(address: string, key: string) {
  const now = Date.now()
  if ((deniedLogged.get(address) || 0) > now - DENIED_LOG_INTERVAL) {
    return
  }
  if (deniedLogged.size > 1000) {
    deniedLogged.forEach(function(time, logged) {
      if (time <= now - DENIED_LOG_INTERVAL) {
        deniedLogged.delete(logged)
      }
    })
  }
  deniedLogged.set(address, now)
  log.warn('Refused the ZeroMQ client %s with the unknown key "%s"', address, key)
}

async function serveZap(router: zmq.Router) {
  try {
    for await (const frames of router) {
      // routing id, delimiter, version, request id, domain, address, identity, mechanism, key
      const [routingId, delimiter, , requestId, , address, , mechanism, credentials] = frames
      const key = credentials ? Buffer.from(credentials).toString('hex') : ''
      const allowed = String(mechanism) === 'CURVE' && allowedClients.has(key)
      if (!allowed) {
        logDenied(String(address), key)
      }
      await router.send([
        routingId!
      , delimiter!
      , '1.0'
      , requestId!
      , allowed ? '200' : '400'
      , allowed ? 'OK' : 'Unknown client key'
      , ''
      , ''
      ])
    }
  }
  catch (err) {
    if (!router.closed) {
      log.fatal('The ZAP handler failed', err)
      lifecycle.fatal()
    }
  }
}

export function stopZapHandler() {
  if (zapHandler) {
    zapHandler.close()
    zapHandler = null
  }
}

function startZapHandler(clients: Set<string>) {
  allowedClients = clients
  if (zapHandler) {
    return
  }
  const router = new zmq.Router()
  zapHandler = router
  router.bind(ZAP_ENDPOINT).then(
    function() {
      // it ends when the router is closed, an error ends the process
      return serveZap(router)
    }
  , function(err: Error) {
      log.fatal('Unable to start the ZAP handler', err)
      lifecycle.fatal()
    }
  )
  lifecycle.observe(stopZapHandler)
}

// The zeromq socket behind a compat one: the compat API has no ZAP_ENFORCE_DOMAIN
function nativeSocket(sock: CompatSocket): zmq.Socket {
  const native = (sock as unknown as {_socket?: zmq.Socket})._socket
  if (!native) {
    throw new Error('CURVE: unsupported version of zeromq, no socket behind the compat one')
  }
  return native
}

function isTcp(address: string) {
  return /^tcp:\/\//i.test(address)
}

// secure(<compat socket>): the socket with the CURVE options of the variables applied when it binds
// or connects a tcp endpoint, the same socket without them
export function secure<S extends CompatSocket>(sock: S, curve: CurveConfig = currentConfig()): S {
  const server = curve.server
  const client = curve.client
  if (!server && !client) {
    return sock
  }
  const native = nativeSocket(sock)

  if (server) {
    const serve = function(address: string) {
      if (isTcp(address)) {
        native.curveServer = true
        native.curveSecretKey = z85(server.secretKey)
        native.zapDomain = ZAP_DOMAIN
        native.zapEnforceDomain = true
        startZapHandler(server.clients)
      }
    }
    const bind = sock.bind
    // eslint-disable-next-line no-sync
    const bindSync = sock.bindSync
    sock.bind = function(address: string, callback?: (err?: Error) => void) {
      serve(address)
      return bind.call(sock, address, callback)
    }
    // eslint-disable-next-line no-sync
    sock.bindSync = function(address: string) {
      serve(address)
      return bindSync.call(sock, address)
    }
  }

  if (client) {
    const connect = sock.connect
    sock.connect = function(address: string) {
      if (isTcp(address)) {
        native.curveServer = false
        native.curveServerKey = z85(client.serverKey)
        native.curvePublicKey = z85(client.publicKey)
        native.curveSecretKey = z85(client.secretKey)
      }
      return connect.call(sock, address)
    }
  }

  return sock
}

export default {config, generateKeyPair, publicKeyOf, secure, stopZapHandler, z85}
