/**
* Fork (Zebrunner): CURVE security of the ZeroMQ sockets (http://curvezmq.org). The messages of the
* units and of the device providers are encrypted, and the triproxies accept only the clients whose
* keys they know.
*
* The keys are hex strings of 32 bytes (64 characters), `stf curve-keygen` prints them:
* - STF_ZMQ_CURVE_SERVER_SECRET_KEY: the bound tcp sockets (the triproxies) are CURVE servers with
*   this key. A ZAP handler (RFC 27) lets in only the public keys of the clients and the key of
*   the unit itself; without the handler libzmq refuses every client (ZAP_ENFORCE_DOMAIN), it does
*   not let them in. The keys of the clients are:
*   - STF_ZMQ_CURVE_CLIENT_KEY_<HOST>: one key per variable, <HOST> ([A-Za-z0-9_]+) a free label
*     of the device host; an empty one is ignored (a placeholder);
*   - STF_ZMQ_CURVE_CLIENT_KEYS: keys separated by commas or spaces.
* - STF_ZMQ_CURVE_SERVER_PUBLIC_KEY and STF_ZMQ_CURVE_SECRET_KEY: the connecting tcp sockets are
*   CURVE clients of that server with this secret key; its public key is derived from it. A client
*   logs the refusal of its key: libzmq does not connect a refused socket again, the refusal is the
*   only trace of it on this side.
* Without these variables the sockets have no security, as in upstream.
*
* The keys of the enrolled nodes (ZEBRUNNER.md#nodes-enrollment) come from the API unit when
* STF_NODES_API_URL is set (lib/util/zebrunner-nodes-client.ts): the keys of the active nodes are
* allowed too, the keys of the revoked nodes and the retired keys are refused even when a variable
* has them (deny wins).
**/

import crypto from 'crypto'

import * as zmq from 'zeromq'

import lifecycle from './lifecycle.js'
import logger from './logger.js'
import nodesClient, {
  KEYS_INTERVAL
, type ClientOptions
, type NodeKeys
, type Watcher
} from './zebrunner-nodes-client.js'

const log = logger.createLogger('util:zmqcurve')

const KEY = /^[0-9a-f]{64}$/i
// One client key per variable, the suffix a label of the host
const CLIENT_KEY_VAR = /^STF_ZMQ_CURVE_CLIENT_KEY_([A-Za-z0-9_]+)$/
// The DER prefixes of the X25519 keys, followed by the 32 bytes of the key
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const ZAP_ENDPOINT = 'inproc://zeromq.zap.01'
const ZAP_DOMAIN = 'stf'
// A refused client (or a server refusing this one) is logged once in this time, not on every
// reconnect
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
    // the labels of the STF_ZMQ_CURVE_CLIENT_KEY_<HOST> variables with a key, sorted
    hosts: string[]
    // the API unit with the keys of the enrolled nodes (STF_NODES_API_URL)
    nodes?: ClientOptions | null
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
    const hosts: string[] = []
    Object.keys(env).sort().forEach(function(name) {
      const match = CLIENT_KEY_VAR.exec(name)
      const value = (env[name] || '').trim()
      if (match && value) {
        clients.add(parseKey(name, value).toString('hex'))
        hosts.push(match[1]!)
      }
    })
    if (own) {
      clients.add(publicKeyOf(own).toString('hex'))
    }
    // Fork (Zebrunner): or the keys of the enrolled nodes
    const nodes = nodesClient.clientOptions(env)
    if (!clients.size && !nodes) {
      throw new Error('STF_ZMQ_CURVE_SERVER_SECRET_KEY needs the keys of the clients: ' +
        'STF_ZMQ_CURVE_CLIENT_KEY_<HOST>, STF_ZMQ_CURVE_CLIENT_KEYS or STF_ZMQ_CURVE_SECRET_KEY')
    }
    result.server = {
      secretKey: parseKey('STF_ZMQ_CURVE_SERVER_SECRET_KEY', env.STF_ZMQ_CURVE_SERVER_SECRET_KEY)
    , clients: clients
    , hosts: hosts
    , nodes: nodes
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
      log.info(
        'CURVE server: %d client keys are allowed (STF_ZMQ_CURVE_CLIENT_KEY_<HOST> of: %s)'
      , current.server.clients.size
      , current.server.hosts.join(', ') || 'none'
      )
    }
    if (current.client) {
      log.info('CURVE client with the public key %s', current.client.publicKey.toString('hex'))
    }
  }
  return current
}

// What to check when the messages of this client do not reach the server, for the fatal errors of
// the device units
export function clientHint(curve: CurveConfig = currentConfig()): string {
  if (curve.client) {
    return 'Check that the ZeroMQ server lets this host in: its CURVE public key as ' +
      `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>=${curve.client.publicKey.toString('hex')} (or in ` +
      'STF_ZMQ_CURVE_CLIENT_KEYS) of the server (restart the server after a change), ' +
      'STF_ZMQ_CURVE_SERVER_PUBLIC_KEY the one of the server, the triproxy endpoints reachable.'
  }
  return 'Check that the triproxy endpoints are reachable.'
}

// once <logged> <key>: true when the key was not logged in DENIED_LOG_INTERVAL, its time kept then
function once(logged: Map<string, number>, key: string): boolean {
  const now = Date.now()
  if ((logged.get(key) || 0) > now - DENIED_LOG_INTERVAL) {
    return false
  }
  if (logged.size > 1000) {
    logged.forEach(function(time, other) {
      if (time <= now - DENIED_LOG_INTERVAL) {
        logged.delete(other)
      }
    })
  }
  logged.set(key, now)
  return true
}

// The ZAP handler of the process: one for all the CURVE servers, as libzmq asks the single
// inproc://zeromq.zap.01 endpoint of the context
let zapHandler: zmq.Router | null = null
let allowedClients = new Set<string>()
const deniedLogged = new Map<string, number>()

export interface NodeKeySets {
  allowed: Set<string>
  denied: Set<string>
}

const NO_NODE_KEYS: NodeKeySets = {allowed: new Set(), denied: new Set()}
let nodeKeys = NO_NODE_KEYS
let nodeWatcher: Watcher | null = null

// isAllowedKey <key> <clients> <nodes>: the keys of the variables and of the active nodes, minus
// the keys of the revoked nodes and the retired ones: deny wins
export function isAllowedKey(
  key: string
, clients: Set<string>
, nodes: NodeKeySets = nodeKeys
): boolean {
  return !nodes.denied.has(key) && (clients.has(key) || nodes.allowed.has(key))
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && Array.from(a).every(function(key) {
    return b.has(key)
  })
}

// The keys of the enrolled nodes from the API unit
export function setNodeKeys(keys: NodeKeys) {
  const next = {allowed: new Set(keys.allowed), denied: new Set(keys.denied)}
  if (!sameSet(next.allowed, nodeKeys.allowed) || !sameSet(next.denied, nodeKeys.denied)) {
    log.info(
      'CURVE server: %d keys of active nodes are allowed, %d keys of revoked nodes or retired ' +
      'are refused'
    , next.allowed.size
    , next.denied.size
    )
  }
  nodeKeys = next
}

function logDenied(address: string, key: string) {
  if (once(deniedLogged, address)) {
    if (nodeKeys.denied.has(key)) {
      log.warn(
        'Refused the ZeroMQ client %s with the key "%s" of a revoked node (or a retired key)'
      , address
      , key
      )
      return
    }
    log.warn(
      'Refused the ZeroMQ client %s with the unknown key "%s" (allow it with ' +
      'STF_ZMQ_CURVE_CLIENT_KEY_<HOST>=<key> or STF_ZMQ_CURVE_CLIENT_KEYS)'
    , address
    , key
    )
  }
}

// The refusals of the key of this client, by the address of the server
const refusedLogged = new Map<string, number>()
const monitored = new WeakSet<zmq.Socket>()

// A refusal ends the connection for good (a protocol error for libzmq, no reconnect)
function monitorRefusal(native: zmq.Socket, publicKey: Buffer) {
  if (monitored.has(native)) {
    return
  }
  monitored.add(native)
  native.events.on('handshake:error:auth', function(event) {
    if (once(refusedLogged, event.address)) {
      log.warn(
        'The ZeroMQ server %s refused the CURVE key %s of this host: add it to the server as ' +
        'STF_ZMQ_CURVE_CLIENT_KEY_<HOST>=<key> (or to STF_ZMQ_CURVE_CLIENT_KEYS) and restart it'
      , event.address
      , publicKey.toString('hex')
      )
    }
  })
}

async function serveZap(router: zmq.Router) {
  try {
    for await (const frames of router) {
      // routing id, delimiter, version, request id, domain, address, identity, mechanism, key
      const [routingId, delimiter, , requestId, , address, , mechanism, credentials] = frames
      const key = credentials ? Buffer.from(credentials).toString('hex') : ''
      const allowed = String(mechanism) === 'CURVE' && isAllowedKey(key, allowedClients)
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

// The start and the stop of the ZAP handler run one after the other: libzmq releases the inproc
// endpoint of a closed router later (its reaper thread), so a new router binds only once the old one
// is unbound and closed
let zapQueue: Promise<void> = Promise.resolve()
let observing = false
let zapStarts = 0
const ZAP_BIND_RETRIES = 50
const ZAP_BIND_RETRY_DELAY = 20

function enqueue(task: () => Promise<void>): Promise<void> {
  zapQueue = zapQueue.then(task, task)
  return zapQueue
}

async function bindZap(router: zmq.Router) {
  for (let attempt = 1; !router.closed; attempt++) {
    try {
      await router.bind(ZAP_ENDPOINT)
      return
    }
    catch (err) {
      // the endpoint of a router closed a moment ago, until the reaper of libzmq releases it
      if ((err as {code?: string}).code !== 'EADDRINUSE' || attempt >= ZAP_BIND_RETRIES) {
        throw err
      }
      await new Promise(function(resolve) {
        setTimeout(resolve, ZAP_BIND_RETRY_DELAY)
      })
    }
  }
}

// The number of the ZAP handlers the process started, for the tests
export function zapHandlerStarts() {
  return zapStarts
}

// Resolves once the pending starts and stops of the ZAP handler are done
export function zapHandlerReady(): Promise<void> {
  return zapQueue
}

// stopZapHandler: stops the handler and the reading of the keys of the nodes; resolves once the
// endpoint is free again
export function stopZapHandler(): Promise<void> {
  if (nodeWatcher) {
    nodeWatcher.stop()
    nodeWatcher = null
  }
  nodeKeys = NO_NODE_KEYS
  const router = zapHandler
  zapHandler = null
  if (!router) {
    return zapQueue
  }
  return enqueue(async function() {
    if (!router.closed) {
      await router.unbind(ZAP_ENDPOINT).catch(function() {})
      router.close()
    }
  })
}

function watchNodeKeys(nodes: ClientOptions | null | undefined) {
  if (!nodes || nodeWatcher) {
    return
  }
  log.info(
    'CURVE server: the keys of the enrolled nodes are read from %s every %d s'
  , nodes.url
  , KEYS_INTERVAL / 1000
  )
  // a new set of keys only replaces the sets the running handler checks, it never restarts it
  nodeWatcher = nodesClient.watchNodeKeys(nodes, setNodeKeys)
}

// startZapHandler: starts the handler of the process once, whatever the number of the sockets that
// bind; resolves once it is bound
function startZapHandler(clients: Set<string>, nodes?: ClientOptions | null): Promise<void> {
  allowedClients = clients
  watchNodeKeys(nodes)
  if (zapHandler) {
    return zapQueue
  }
  const router = new zmq.Router()
  zapHandler = router
  zapStarts++
  if (!observing) {
    observing = true
    lifecycle.observe(stopZapHandler)
  }
  return enqueue(async function() {
    try {
      await bindZap(router)
    }
    catch (err) {
      if (!router.closed) {
        log.fatal('Unable to start the ZAP handler', err)
        lifecycle.fatal()
      }
      return
    }
    if (!router.closed) {
      // it ends when the router is closed, an error ends the process
      serveZap(router)
    }
  })
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
        startZapHandler(server.clients, server.nodes)
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
        monitorRefusal(native, client.publicKey)
      }
      return connect.call(sock, address)
    }
  }

  return sock
}

export default {
  clientHint
, config
, generateKeyPair
, isAllowedKey
, publicKeyOf
, secure
, setNodeKeys
, stopZapHandler
, z85
, zapHandlerReady
, zapHandlerStarts
}
