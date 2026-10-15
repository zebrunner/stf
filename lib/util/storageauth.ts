/**
* Fork (Zebrunner): authentication of the storage routes (/s/upload, /s/download, /s/blob).
*
* Two kinds of callers are let in:
* - the units of STF (device workers, storage plugins) with the shared token of the deployment
*   (STF_STORAGE_TOKEN) in the `x-stf-internal-token` header;
* - signed-in users with the session cookie of the app unit, signed with the auth secret.
*
* The storage plugins proxy /s/blob, they forward the credentials of their caller instead of having
* their own, so a plugin route is as protected as the storage route behind it.
**/

import crypto from 'crypto'
import type http from 'http'

import cookieSession from 'cookie-session'
import type express from 'express'

import logger from './logger.js'

export const TOKEN_HEADER = 'x-stf-internal-token'

const FORWARDED_HEADERS = ['cookie', TOKEN_HEADER]

export interface StorageAuthOptions {
  secret?: string
  storageToken?: string
  ssid?: string
}

// The options the storage units take for the fork: auth and the networks of urlsafety.download()
export type StorageSecurityOptions = StorageAuthOptions & {downloadAllow?: string[]}

function internalToken() {
  return process.env.STF_STORAGE_TOKEN || ''
}

// The headers of a request of an STF unit to the storage, empty when no token is configured
function internalHeaders(): Record<string, string> {
  const token = internalToken()
  return token ? {[TOKEN_HEADER]: token} : {}
}

// Adds the token header to the options of a request, leaves them as they are without a token
function sign<T extends object>(options: T & {headers?: Record<string, string>}): T {
  const headers = internalHeaders()
  if (!Object.keys(headers).length) {
    return options
  }
  return {...options, headers: {...options.headers, ...headers}}
}

// The credentials of the caller of a storage plugin, to forward to the storage
function forwardHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  FORWARDED_HEADERS.forEach(function(name) {
    const value = req.headers[name]
    if (typeof value === 'string') {
      headers[name] = value
    }
  })
  return headers
}

function sameToken(given: unknown, expected: Buffer) {
  if (typeof given !== 'string') {
    return false
  }
  const buffer = Buffer.from(given)
  return buffer.length === expected.length && crypto.timingSafeEqual(buffer, expected)
}

// The middleware of the storage units. Without a secret and a token, e.g. in the unit tests of
// upstream, the routes stay open; the CLIs of the storage units require both.
function middleware(options: StorageAuthOptions): express.RequestHandler {
  const log = logger.createLogger('storage:auth')

  if (!options.secret || !options.storageToken) {
    log.warn('The storage routes are not authenticated, set a secret and a storage token')
    return function(req, res, next) {
      next()
    }
  }

  const expectedToken = Buffer.from(options.storageToken)
  const parseSession = cookieSession({
    name: options.ssid || 'ssid'
  , keys: [options.secret]
  })

  return function(req, res, next) {
    if (sameToken(req.headers[TOKEN_HEADER], expectedToken)) {
      next()
      return
    }
    parseSession(req, res, function() {
      const session = req.session as {jwt?: {email?: string}} | null | undefined
      if (session && session.jwt && session.jwt.email) {
        next()
        return
      }
      log.warn('Rejected unauthenticated %s %s from %s', req.method, req.originalUrl, req.ip)
      res.status(401).json({
        success: false
      , error: 'Unauthorized'
      })
    })
  }
}

export default {
  TOKEN_HEADER
, forwardHeaders
, internalHeaders
, middleware
, sign
}
