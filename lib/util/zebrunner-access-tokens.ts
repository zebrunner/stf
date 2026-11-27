/**
* Fork (Zebrunner): the access tokens of the API (Authorization: ******, the grid of mcloud)
* are kept as hashes (ZEBRUNNER.md#access-tokens).
*
* - the secret: 64 hex characters (32 random bytes), given once by its creation (the API, Settings >
*   Keys, `stf token-add`), never stored;
* - the document of the table accessTokens: its id is `sha256:<hex sha256 of the secret>`, with the
*   email, the title, createdAt and expiresAt (null: no expiry), no JWT;
* - a token with expiresAt is refused from that time on;
* - an earlier document (the id is the secret, with a JWT of the user) is still found by its secret
*   until `stf migrate` replaced it by its hash (hashedDocument), then only the hashes are found: a
*   secret with the prefix is never looked up as an id, so a hash is never taken as a token.
**/

import crypto from 'crypto'

import jwtutil from './jwtutil.js'

export const HASH_PREFIX = 'sha256:'

// the bounds of the lifetime of a new token, seconds: a minute to ten years
export const MIN_TTL_SECONDS = 60
export const MAX_TTL_SECONDS = 10 * 365 * 24 * 60 * 60

export interface StoredAccessToken {
  id: string
  email: string
  title: string
  jwt?: string
  createdAt?: Date | null
  expiresAt?: Date | null
}

// newSecret: the secret of a new token
export function newSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

// hashId <secret>: the id of the document of a secret
export function hashId(secret: string): string {
  return HASH_PREFIX + crypto.createHash('sha256').update(secret).digest('hex')
}

// isHashedId <id>: the document keeps the hash of its secret, not the secret
export function isHashedId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(HASH_PREFIX)
}

// isLegacySecret <secret>: a secret that may be the id of an earlier document: any but a hashed id, so
// the hash of a token (a copy of the database) is never taken as a token
export function isLegacySecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.length > 0 && !isHashedId(secret)
}

// ttlError <ttl>: why a lifetime (seconds) is refused, null for none (no expiry) or a valid one
export function ttlError(ttl: unknown): string | null {
  if (typeof ttl === 'undefined' || ttl === null || ttl === '') {
    return null
  }
  if (typeof ttl !== 'number' || !Number.isInteger(ttl)) {
    return 'the ttl is not a whole number of seconds'
  }
  if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    return `the ttl is not between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} seconds`
  }
  return null
}

// expiryOf <ttl> [now]: the expiry of a new token of a valid lifetime (seconds), null for none
export function expiryOf(ttl: number | null | undefined, now = Date.now()): Date | null {
  return typeof ttl === 'number' ? new Date(now + ttl * 1000) : null
}

// isExpired <token> [now]: the token has an expiry and it has come
export function isExpired(token: {expiresAt?: Date | string | number | null}, now = Date.now()) {
  if (typeof token.expiresAt === 'undefined' || token.expiresAt === null) {
    return false
  }
  var time = new Date(token.expiresAt).getTime()
  // an unreadable expiry is an expired token
  return !(time > now)
}

// newDocument <secret> <email> <title> [expiresAt]: the document of a new token
export function newDocument(
  secret: string
, email: string
, title: string
, expiresAt: Date | null = null
): StoredAccessToken {
  return {
    id: hashId(secret)
  , email: email
  , title: title
  , createdAt: new Date()
  , expiresAt: expiresAt
  }
}

// hashedDocument <earlier document>: the document of an earlier token with the hash of its secret
// (the id), without its JWT, for stf migrate
export function hashedDocument(token: StoredAccessToken): StoredAccessToken {
  return {
    id: hashId(token.id)
  , email: token.email
  , title: token.title
  , createdAt: token.createdAt || null
  , expiresAt: token.expiresAt || null
  }
}

// emailOf <document> <secret of the units>: the user of a token that is valid now, null otherwise;
// an earlier document (not yet hashed by stf migrate) is the user of its JWT, signed with the secret
// of the units, as before
export function emailOf(
  token: StoredAccessToken | null | undefined
, secret: string
): string | null {
  if (!token || isExpired(token)) {
    return null
  }
  if (isHashedId(token.id)) {
    return typeof token.email === 'string' && token.email ? token.email : null
  }
  var data = token.jwt ? jwtutil.decode(token.jwt, secret) : null
  return data && typeof data.email === 'string' ? data.email : null
}

// published <document> [secret]: the token in an answer: the title and the expiry, the secret only
// when the token was just made (never the hash, the email or a JWT)
export function published(token: {title: string, expiresAt?: Date | null}, secret?: string) {
  var answer: {id?: string, title: string, expiresAt: Date | null} = {
    title: token.title
  , expiresAt: token.expiresAt || null
  }
  if (secret) {
    answer.id = secret
  }
  return answer
}

export default {
  HASH_PREFIX
, MIN_TTL_SECONDS
, MAX_TTL_SECONDS
, newSecret
, hashId
, isHashedId
, isLegacySecret
, ttlError
, expiryOf
, isExpired
, newDocument
, hashedDocument
, emailOf
, published
}
