/**
* Fork (Zebrunner): the pin of the TLS key of MCloud for the requests of the device units to it.
*
* The device units send the token of their node (STF_NODE_TOKEN) to the storage of MCloud: the
* downloads of the apps to install, the uploads of the screenshots and of the files. With
* MCLOUD_TLS_PIN (base64 of the SHA-256 of the DER SubjectPublicKeyInfo of the certificate of
* MCloud, as `curl --pinnedpubkey sha256//<pin>` takes it; several pins separated by ';' or ',',
* each one with or without the `sha256//` prefix) these requests go only to a server that proves
* the pinned key in the TLS handshake: the certificate chain and its name do not count for them then,
* so neither a certificate a public CA issued by mistake, nor any certificate of a private CA, nor
* NODE_TLS_REJECT_UNAUTHORIZED=0 lets another server get the token. The request is sent only after
* the check. An invalid MCLOUD_TLS_PIN fails every such request (fails closed). Without
* MCLOUD_TLS_PIN the requests verify the certificate as before (the CAs of Node.js and
* NODE_EXTRA_CA_CERTS).
**/

import crypto from 'crypto'
import type http from 'http'
import https from 'https'
import type {Duplex} from 'stream'
import tls from 'tls'

import logger from './logger.js'

const log = logger.createLogger('util:tlspin')

const PIN = /^[A-Za-z0-9+/]{43}=$/

export class TlsPinError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TlsPinError'
  }
}

// parsePins <value>: the pins of the value, null without a value; throws for an invalid pin
export function parsePins(value: string | undefined | null): string[] | null {
  const text = (value || '').trim()
  if (!text) {
    return null
  }
  return text.split(/[;,]/).map(function(part) {
    const pin = part.trim().replace(/^sha256\/\//, '')
    if (!PIN.test(pin)) {
      throw new TlsPinError('MCLOUD_TLS_PIN must be base64 SHA-256 pins of the TLS key of MCloud')
    }
    return pin
  })
}

// spkiPin <certificate in DER>: base64 of the SHA-256 of its DER SubjectPublicKeyInfo
export function spkiPin(der: Buffer): string {
  const spki = new crypto.X509Certificate(der).publicKey.export({type: 'spki', format: 'der'})
  return crypto.createHash('sha256').update(spki).digest('base64')
}

type ConnectCallback = (err: Error | null, stream: Duplex) => void

// An https agent that hands a connection to the request only after the server proved a pinned key
// in the TLS handshake; nothing is written before. No keep-alive and no TLS session reuse: every
// connection is checked.
export class PinnedAgent extends https.Agent {
  readonly pins: string[] | null
  readonly invalid: string

  constructor(pins: string[] | null, invalid = '') {
    super({keepAlive: false, maxCachedSessions: 0})
    this.pins = pins
    this.invalid = invalid
  }

  // the signature node:_http_agent calls: (options, callback); null: the callback hands the socket
  createConnection(options: http.RequestOptions, callback?: ConnectCallback): Duplex | null {
    const done: ConnectCallback = callback || function() {
      // the socket is handed by the callback only
    }
    if (this.invalid || !this.pins) {
      const error = new TlsPinError(this.invalid || 'No pin of the TLS key of MCloud')
      process.nextTick(function() {
        // node:_http_agent ignores the stream of an error
        done(error, null as unknown as Duplex)
      })
      return null
    }
    const pins = this.pins
    const tlsOptions = options as tls.ConnectionOptions
    const host = tlsOptions.servername || tlsOptions.host || ''
    // the pin is the check: the chain and the name are not trusted for MCloud
    const socket = tls.connect(Object.assign({}, tlsOptions, {rejectUnauthorized: false}))
    let settled = false
    const finish = function(err: Error | null) {
      if (settled) {
        return
      }
      settled = true
      if (err) {
        socket.destroy()
      }
      done(err, socket)
    }
    socket.once('error', finish)
    socket.once('secureConnect', function() {
      let pin = ''
      try {
        const cert = socket.getPeerCertificate(false)
        pin = cert && cert.raw ? spkiPin(cert.raw) : ''
      }
      catch (err) {
        pin = ''
      }
      if (pin && pins.indexOf(pin) !== -1) {
        finish(null)
        return
      }
      log.error(
        'Refused %s: its TLS key is not the pinned one of MCloud (MCLOUD_TLS_PIN), its pin is %s'
      , host
      , pin || 'unknown'
      )
      finish(new TlsPinError('The TLS key of MCloud is not the pinned one'))
    })
    return null
  }
}

function createAgent(env: NodeJS.ProcessEnv): PinnedAgent | null {
  try {
    const pins = parsePins(env.MCLOUD_TLS_PIN)
    if (!pins) {
      return null
    }
    log.info('The requests to the storage of MCloud trust only the pinned TLS key (MCLOUD_TLS_PIN)')
    return new PinnedAgent(pins)
  }
  catch (err) {
    log.error('%s: the requests to the storage of MCloud are refused', (err as Error).message)
    return new PinnedAgent(null, (err as Error).message)
  }
}

// the agent of process.env, made once; false: not made yet
let shared: PinnedAgent | null | false = false

// agent: the pinned agent of MCLOUD_TLS_PIN, null without it (the requests verify the certificate
// as before); an invalid value gives an agent that refuses every connection
export function agent(env: NodeJS.ProcessEnv = process.env): PinnedAgent | null {
  if (env !== process.env) {
    return createAgent(env)
  }
  if (shared === false) {
    shared = createAgent(env)
  }
  return shared
}

// agentFor <url>: the pinned agent for an https URL, null for http or without a pin
export function agentFor(url: string, env: NodeJS.ProcessEnv = process.env): PinnedAgent | null {
  return /^https:/i.test(url) ? agent(env) : null
}

// reset: forgets the agent of the environment (the tests)
export function reset() {
  shared = false
}

export default {
  PinnedAgent
, TlsPinError
, agent
, agentFor
, parsePins
, reset
, spkiPin
}
