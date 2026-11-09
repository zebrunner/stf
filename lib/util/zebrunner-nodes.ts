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
*   node token.
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
, RESERVED_LABELS
, deviceBinding
, generateInvite
, generateNodeToken
, isInvite
, isLabel
, nodeProof
, normalizeAddress
, parseScreenUri
, proofMessage
, sameAddress
, sameHash
, sameSecret
, sha256
, tokenLabel
, verifyNodeProof
}
