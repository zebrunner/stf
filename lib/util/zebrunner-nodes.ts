/**
* Fork (Zebrunner): the identifiers and secrets of the enrolled device hosts ("nodes",
* ZEBRUNNER.md#nodes-enrollment).
*
* - label: the unique name of a node, `^[a-z0-9][a-z0-9-]{0,39}$`;
* - node token: `mcn1.<label>.<secret>`, the secret 32 random bytes in base64url; the server keeps
*   sha256(token) only;
* - invite: `mci1.<secret>`, single use, the server keeps sha256(invite) only;
* - address: the host the server connects to (STF_PROVIDER_HOST of the node), an IPv4 address or a
*   host name;
* - node proof: the HMAC-SHA256 of the registration of a device, keyed with the raw sha256 of the
*   node token;
* - WireGuard key (the opt-in tunnel of the nodes): base64 of 32 bytes, as `wg pubkey` prints it.
*
* Secrets are compared through their hashes in constant time; none of them is ever logged.
**/

import crypto from 'crypto'

export const LABEL = /^[a-z0-9][a-z0-9-]{0,39}$/
export const NODE_TOKEN = /^mcn1\.([a-z0-9][a-z0-9-]{0,39})\.([A-Za-z0-9_-]{43})$/
export const INVITE = /^mci1\.[A-Za-z0-9_-]{43}$/
export const PUBLIC_KEY = /^[0-9a-fA-F]{64}$/
const HASH = /^[0-9a-f]{64}$/

export const INVITE_TTL_MINUTES = 60
export const INVITE_MAX_TTL_MINUTES = 1440

// The static paths of /api/v1/nodes/...: DELETE /nodes/{label} could not reach a node of these
// labels
export const RESERVED_LABELS = ['enroll', 'invites', 'relay', 'self', 'verify']

// The host names that are this host or the metadata service of a cloud, by name
const FORBIDDEN_HOSTS = new RegExp('^(' + [
  'localhost'
, '.*\\.localhost'
, 'localhost\\.localdomain'
, 'ip6-localhost'
, 'ip6-loopback'
, 'metadata'
, 'metadata\\.google\\.internal'
, 'instance-data'
, 'instance-data\\.ec2\\.internal'
].join('|') + ')$')
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isLabel(value: unknown): value is string {
  return typeof value === 'string' && LABEL.test(value) && RESERVED_LABELS.indexOf(value) === -1
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

// sameHash <a> <b>: whether two sha256 hex strings are equal, in constant time
export function sameHash(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !HASH.test(a) || !HASH.test(b)) {
    return false
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

// sameSecret <given> <expected>: whether a secret equals the expected one, compared through their
// hashes, so neither the time nor the length tells anything
export function sameSecret(given: unknown, expected: string | undefined): boolean {
  if (typeof given !== 'string' || !given || !expected) {
    return false
  }
  return sameHash(sha256(given), sha256(expected))
}

function secret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function generateNodeToken(label: string): string {
  return `mcn1.${label}.${secret()}`
}

export function generateInvite(): string {
  return `mci1.${secret()}`
}

// The label of a node token, null for anything else
export function tokenLabel(token: unknown): string | null {
  if (typeof token !== 'string') {
    return null
  }
  const match = NODE_TOKEN.exec(token)
  return match ? match[1]! : null
}

export function isInvite(value: unknown): value is string {
  return typeof value === 'string' && INVITE.test(value)
}

function ipv4Allowed(octets: number[], loopback: boolean): boolean {
  const [a, b] = octets as [number, number, number, number]
  if (a === 127) {
    return loopback
  }
  if (a === 0 || a >= 224) {
    // this network and 0.0.0.0, loopback, multicast, reserved and broadcast
    return false
  }
  // link-local, the metadata services of the clouds (169.254.169.254)
  return !(a === 169 && b === 254)
}

// normalizeAddress <value>: the address of a node in lower case, null when it is not an IPv4
// address or a host name (a scheme, a port, a path, an IPv6 address) or a forbidden one: loopback,
// link-local, metadata, 0.0.0.0, multicast
// (loopback: also 127/8 and localhost, for `stf node-add` of a development or test setup)
export function normalizeAddress(
  value: unknown
, options: {loopback?: boolean} = {}
): string | null {
  if (typeof value !== 'string' || !value || value.length > 253) {
    return null
  }
  const address = value.toLowerCase()
  const ipv4 = IPV4.exec(address)
  if (ipv4) {
    const parts = ipv4.slice(1)
    if (parts.some(function(part) {
      return part.length > 1 && part.startsWith('0')
    })) {
      return null
    }
    const octets = parts.map(Number)
    if (octets.some(function(octet) {
      return octet > 255
    })) {
      return null
    }
    return ipv4Allowed(octets, Boolean(options.loopback)) ? address : null
  }
  const labels = address.split('.')
  if (!labels.every(function(label) {
    return HOST_LABEL.test(label)
  })) {
    return null
  }
  // 1.2.3, 10.1 and the like are IPv4 addresses for some resolvers
  if (/^[0-9]+$/.test(labels[labels.length - 1]!)) {
    return null
  }
  if (options.loopback && address === 'localhost') {
    return address
  }
  return FORBIDDEN_HOSTS.test(address) ? null : address
}

export function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
}

// The opt-in WireGuard tunnel between the head and its nodes (ZEBRUNNER.md#wireguard-tunnel): a
// key is the base64 of 32 bytes (`wg genkey`, `wg pubkey`)
export const WG_PUBLIC_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/
// the nodes are behind NAT: they keep their side of the tunnel open
export const WG_PERSISTENT_KEEPALIVE = 25

export function isWgPublicKey(value: unknown): value is string {
  return typeof value === 'string' && WG_PUBLIC_KEY.test(value)
}

// The number of a dotted IPv4 address (no leading zeros), null for anything else
function ipv4Number(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = IPV4.exec(value)
  if (!match) {
    return null
  }
  const parts = match.slice(1)
  if (parts.some(function(part) {
    return (part.length > 1 && part.startsWith('0')) || Number(part) > 255
  })) {
    return null
  }
  return parts.reduce(function(number, part) {
    return number * 256 + Number(part)
  }, 0)
}

export interface Cidr {
  // the address of the network and its prefix length
  network: number
  prefix: number
  cidr: string
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

// parseCidr <value>: an IPv4 network `a.b.c.d/n`, null for anything else or a network with host
// bits set (10.234.0.1/24)
export function parseCidr(value: unknown): Cidr | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = /^([0-9.]+)\/([0-9]{1,2})$/.exec(value)
  if (!match || (match[2]!.length > 1 && match[2]!.startsWith('0'))) {
    return null
  }
  const network = ipv4Number(match[1])
  const prefix = Number(match[2])
  if (network === null || prefix > 32 || ((network & ~maskOf(prefix)) >>> 0) !== 0) {
    return null
  }
  return {network: network, prefix: prefix, cidr: value}
}

// inCidr <address> <cidr>: whether an IPv4 address is in the network
export function inCidr(address: unknown, cidr: Cidr | string): boolean {
  const network = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  const number = ipv4Number(address)
  if (!network || number === null) {
    return false
  }
  return ((number & maskOf(network.prefix)) >>> 0) === network.network
}

// isHostOf <address> <cidr>: whether an IPv4 address is a host of the network: in it, and neither
// the address of the network nor its broadcast address (but in a /31 or /32)
export function isHostOf(address: unknown, cidr: Cidr | string): boolean {
  const network = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  if (!network || !inCidr(address, network)) {
    return false
  }
  if (network.prefix >= 31) {
    return true
  }
  const number = ipv4Number(address)!
  const broadcast = (network.network | ~maskOf(network.prefix)) >>> 0
  return number !== network.network && number !== broadcast
}

// The options of the tunnel of the API unit, --nodes-wg-*
export interface WireguardOptions {
  endpoint?: string | null | undefined
  publicKey?: string | null | undefined
  serverAddress?: string | null | undefined
  network?: string | null | undefined
}

// What the head tells an enrolling node of the tunnel
export interface WireguardSettings {
  // host:port, the public UDP endpoint of the head
  endpoint: string
  // the WireGuard public key of the head
  publicKey: string
  // the WireGuard address of the head
  serverAddress: string
  // the network of the tunnel, the address of every node is in it
  network: string
}

const WG_OPTIONS: Array<[keyof WireguardOptions, string]> = [
  ['endpoint', '--nodes-wg-endpoint']
, ['publicKey', '--nodes-wg-public-key']
, ['serverAddress', '--nodes-wg-server-address']
, ['network', '--nodes-wg-network']
]

function isEndpoint(value: string): boolean {
  const match = /^(.+):([0-9]{1,5})$/.exec(value)
  if (!match) {
    return false
  }
  const port = Number(match[2])
  const host = match[1]!
  return port >= 1 && port <= 65535 &&
    (Boolean(normalizeAddress(host, {loopback: true})) || /^\[[0-9a-fA-F:.]+\]$/.test(host))
}

// wireguardSettings <options>: the tunnel of the nodes: settings null and no error when none of the
// options is set (off), else all of them valid, or the error (it never has the values)
export function wireguardSettings(
  options: WireguardOptions | null | undefined
): {settings: WireguardSettings | null, error: string | null} {
  const given = options || {}
  const set = WG_OPTIONS.filter(function([field]) {
    return Boolean(given[field])
  })
  if (!set.length) {
    return {settings: null, error: null}
  }
  const missing = WG_OPTIONS.filter(function([field]) {
    return !given[field]
  })
  if (missing.length) {
    return {
      settings: null
    , error: 'the WireGuard tunnel of the nodes needs all of the options --nodes-wg-*, missing: ' +
        missing.map(function([, name]) {
          return name
        }).join(', ')
    }
  }
  const network = parseCidr(given.network)
  let invalid: string | null = null
  if (!isEndpoint(given.endpoint!)) {
    invalid = '--nodes-wg-endpoint is not <host>:<port>'
  }
  else if (!isWgPublicKey(given.publicKey)) {
    invalid = '--nodes-wg-public-key is not a WireGuard key (base64 of 32 bytes)'
  }
  else if (!network || network.prefix < 8 || network.prefix > 30) {
    invalid = '--nodes-wg-network is not an IPv4 network <address>/<8..30>'
  }
  else if (!isHostOf(given.serverAddress, network)) {
    invalid = '--nodes-wg-server-address is not an IPv4 address of a host of --nodes-wg-network'
  }
  if (invalid) {
    return {settings: null, error: invalid}
  }
  return {
    settings: {
      endpoint: given.endpoint!.toLowerCase()
    , publicKey: given.publicKey!
    , serverAddress: given.serverAddress!
    , network: network!.cidr
    }
  , error: null
  }
}

// isWgNodeAddress <address> <settings>: whether an address can be the address of a node in the
// tunnel: a host of its network, not the head
export function isWgNodeAddress(address: unknown, settings: WireguardSettings): boolean {
  return isHostOf(address, settings.network) && address !== settings.serverAddress
}

export interface ProofFields {
  serial: string
  providerHost: string
  screenPort: number
  connectPort: number
}

export function proofMessage(fields: ProofFields): string {
  return `v1|${fields.serial}|${fields.providerHost}|${fields.screenPort}|${fields.connectPort}`
}

function proofWithKey(key: Buffer, fields: ProofFields): string {
  return crypto.createHmac('sha256', key).update(proofMessage(fields)).digest('hex')
}

// The node proof of the registration of a device: hex HMAC-SHA256(key = raw sha256(token), the
// fields)
export function nodeProof(token: string, fields: ProofFields): string {
  return proofWithKey(crypto.createHash('sha256').update(token).digest(), fields)
}

// verifyNodeProof <tokenHash> <proof> <fields>: whether the proof was made with the token of the
// hash
export function verifyNodeProof(tokenHash: string, proof: unknown, fields: ProofFields): boolean {
  if (typeof proof !== 'string' || !HASH.test(proof) || !HASH.test(tokenHash)) {
    return false
  }
  return sameHash(proofWithKey(Buffer.from(tokenHash, 'hex'), fields), proof)
}

// The node binding a device unit sends with its registration: the label and the proof when the
// container has a node token (STF_NODE_TOKEN), the host of the provider in any case
export interface DeviceBinding {
  node: string | null
  nodeProof: string | null
  providerHost: string | null
}

export function deviceBinding(
  token: string | null | undefined
, fields: Omit<ProofFields, 'providerHost'> & {providerHost?: string | null | undefined}
): DeviceBinding & {warning?: string} {
  const providerHost = fields.providerHost || null
  if (!token) {
    return {
      node: null
    , nodeProof: null
    , providerHost: providerHost
    , warning: 'STF_NODE_TOKEN is not set: STF rejects the devices of a host that is not an ' +
        'enrolled node'
    }
  }
  const label = tokenLabel(token)
  if (!label) {
    return {
      node: null
    , nodeProof: null
    , providerHost: providerHost
    , warning: 'STF_NODE_TOKEN is not a node token (mcn1.<label>.<secret>): STF rejects the ' +
        'devices of this host'
    }
  }
  if (!providerHost) {
    return {
      node: null
    , nodeProof: null
    , providerHost: null
    , warning: 'The host of the provider is not known (STF_PROVIDER_HOST): STF rejects the ' +
        'devices of this host'
    }
  }
  return {
    node: label
  , nodeProof: nodeProof(token, {
      serial: fields.serial
    , providerHost: providerHost
    , screenPort: fields.screenPort
    , connectPort: fields.connectPort
    })
  , providerHost: providerHost
  }
}

// The screen ticket: stf-api gives it to stf-proxy with a screen it allows (GET
// /zebrunner/screen-auth), stf-proxy passes it to the node in SCREEN_TICKET_HEADER and the
// WebSocket of the screen on the node takes only a valid one, so the screen port of a device is no
// screen for the other hosts of its network. v1.<expiry, unix seconds>.<hex HMAC-SHA256(key = raw
// sha256(node token), screen|v1|<serial>|<port>|<expiry>)>: stf-api has the hash of the token, the
// node the token
export const SCREEN_TICKET_HEADER = 'x-mcloud-screen-ticket'

// Fork (Zebrunner): GET /nodes/self names the node of the token in NODE_LABEL_HEADER too, so the
// auth_request of stf-proxy for the MDM paths of the nodes passes it to mcloud-mdm (nginx reads the
// headers of an auth answer, not its body): mcloud-mdm acts only on the devices bound to that node
// (MDM_ENFORCE_NODE_BINDING of mcloud)
export const NODE_LABEL_HEADER = 'x-mcloud-node'
export const SCREEN_TICKET_TTL_SECONDS = 60
const SCREEN_TICKET = /^v1\.([0-9]{1,12})\.([0-9a-f]{64})$/

function screenTicketMac(key: Buffer, serial: string, port: number, expiry: number): string {
  return crypto.createHmac('sha256', key)
    .update(`screen|v1|${serial}|${port}|${expiry}`)
    .digest('hex')
}

// screenTicket <tokenHash> <serial> <port> [now, ms]: the ticket of the screen for the node of the
// hash, null without a valid hash
export function screenTicket(
  tokenHash: unknown
, serial: string
, port: number
, now: number = Date.now()
): string | null {
  if (typeof tokenHash !== 'string' || !HASH.test(tokenHash)) {
    return null
  }
  const expiry = Math.floor(now / 1000) + SCREEN_TICKET_TTL_SECONDS
  return `v1.${expiry}.${screenTicketMac(Buffer.from(tokenHash, 'hex'), serial, port, expiry)}`
}

// verifyScreenTicket <token> <ticket> <serial> <port> [now, ms]: whether the ticket was made for
// the screen by STF with the hash of the node token and has not expired
export function verifyScreenTicket(
  token: unknown
, ticket: unknown
, serial: string
, port: number
, now: number = Date.now()
): boolean {
  if (typeof token !== 'string' || !tokenLabel(token) || typeof ticket !== 'string') {
    return false
  }
  const match = SCREEN_TICKET.exec(ticket)
  if (!match) {
    return false
  }
  const expiry = Number(match[1])
  const seconds = now / 1000
  if (expiry < seconds || expiry > seconds + 2 * SCREEN_TICKET_TTL_SECONDS) {
    return false
  }
  const key = crypto.createHash('sha256').update(token).digest()
  return sameHash(screenTicketMac(key, serial, port, expiry), match[2])
}

function isLoopback(address: unknown): boolean {
  return typeof address === 'string' &&
    (/^(::ffff:)?127\./.test(address) || address === '::1')
}

export interface ScreenClient {
  headers: Record<string, string | string[] | undefined>
  socket: {remoteAddress?: string | undefined}
}

// STF_SCREEN_WITHOUT_TICKET=true: the screen WebSocket takes any client, for a standalone STF
// whose browsers connect to the screen ports themselves (docker-compose.yaml), never for MCloud
export const SCREEN_WITHOUT_TICKET = 'STF_SCREEN_WITHOUT_TICKET'

// screenClientAllowed <request> <token> <serial> <port> [now, ms] [open]: whether the WebSocket of
// the screen of a device unit takes the request: a valid screen ticket from stf-proxy, or a client
// of the container itself (the broadcast of the screen, entrypoint.sh of mcloud-device). Without a
// node token no other client is taken, unless the screens are open (STF_SCREEN_WITHOUT_TICKET)
export function screenClientAllowed(
  req: ScreenClient
, token: unknown
, serial: string
, port: number
, now: number = Date.now()
, open: boolean = process.env[SCREEN_WITHOUT_TICKET] === 'true'
): boolean {
  if (open || isLoopback(req.socket.remoteAddress)) {
    return true
  }
  return verifyScreenTicket(token, req.headers[SCREEN_TICKET_HEADER], serial, port, now)
}

// screenClientOfUser <request>: whether a client of the screen WebSocket is the screen of a user (a
// ticket of stf-proxy, or any client of an open screen), not the container itself: the device unit
// closes such a client when the user leaves the device, as the ticket admits a user once only
export function screenClientOfUser(req: {socket: {remoteAddress?: string | undefined}}): boolean {
  return !isLoopback(req.socket.remoteAddress)
}

export interface ScreenTarget {
  host: string
  serial: string
  port: number
}

// parseScreenUri <uri>: the host, serial and port of a screen URI /d/<host>/<serial>/<port>/ of
// stf-proxy, null for anything else
export function parseScreenUri(uri: unknown): ScreenTarget | null {
  if (typeof uri !== 'string') {
    return null
  }
  const match = /^\/d\/([^/?#]+)\/([^/?#]+)\/([0-9]{1,5})\/(?:[?#].*)?$/.exec(uri)
  if (!match) {
    return null
  }
  try {
    const host = decodeURIComponent(match[1]!).toLowerCase()
    const serial = decodeURIComponent(match[2]!)
    const port = Number(match[3])
    if (!host || !serial || port < 1 || port > 65535 || /[/\s]/.test(host)) {
      return null
    }
    return {host: host, serial: serial, port: port}
  }
  catch (err) {
    return null
  }
}

export default {
  INVITE_MAX_TTL_MINUTES
, INVITE_TTL_MINUTES
, NODE_LABEL_HEADER
, RESERVED_LABELS
, SCREEN_TICKET_HEADER
, SCREEN_WITHOUT_TICKET
, SCREEN_TICKET_TTL_SECONDS
, WG_PERSISTENT_KEEPALIVE
, deviceBinding
, generateInvite
, generateNodeToken
, inCidr
, isHostOf
, isInvite
, isLabel
, isWgNodeAddress
, isWgPublicKey
, nodeProof
, normalizeAddress
, parseCidr
, parseScreenUri
, proofMessage
, sameAddress
, sameHash
, sameSecret
, screenClientAllowed
, screenClientOfUser
, screenTicket
, sha256
, tokenLabel
, verifyNodeProof
, verifyScreenTicket
, wireguardSettings
}
