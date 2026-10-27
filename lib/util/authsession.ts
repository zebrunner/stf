/**
* Fork (Zebrunner): server-side sessions of the signed-in users.
*
* The app unit keeps the user in a signed cookie (cookie-session). Upstream such a cookie is valid
* forever, readable by scripts, and the logout of the UI only deletes it in the browser. Here a
* sign-in creates a session in the database with an expiry (STF_SESSION_TTL_SECONDS, 24 hours by
* default); the app, API and websocket units drop a cookie whose session expired or ended with a
* logout, and the cookie is httpOnly. The units that have no database (storage) check the expiry
* written into the cookie.
*
* Sign-in: lib/units/app/middleware/auth.ts calls establish() where it takes over the token of the
* auth unit. Checks: middleware() in the app and API units, socketMiddleware() in the websocket
* unit. Logout: POST /app/api/v1/logout, answered by middleware().
**/

import crypto from 'crypto'
import type http from 'http'

import Promise from 'bluebird'
import type express from 'express'

import dbapi from '../db/api.js'
import logger from './logger.js'
import {isFresh, type SessionJwt} from './sessionjwt.js'

export {isFresh, type SessionJwt}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60
export const LOGOUT_PATH = '/app/api/v1/logout'

const log = logger.createLogger('util:authsession')

interface SessionOptions {
  httpOnly?: boolean
  sameSite?: string | boolean
  secure?: boolean
  maxAge?: number
}

interface SessionRequest {
  session?: {jwt?: SessionJwt} | null | undefined
  sessionOptions?: SessionOptions | undefined
  headers?: http.IncomingHttpHeaders | undefined
  secure?: boolean | undefined
}

export function ttlSeconds(): number {
  const configured = parseInt(process.env.STF_SESSION_TTL_SECONDS || '', 10)
  return configured > 0 ? configured : DEFAULT_TTL_SECONDS
}

function isHttps(req: SessionRequest): boolean {
  if (req.secure) {
    return true
  }
  const proto = req.headers?.['x-forwarded-proto']
  return String(proto || '').split(',')[0]!.trim().toLowerCase() === 'https'
}

// The cookie options of a session: not readable by scripts, not sent by other sites
function harden(req: SessionRequest) {
  if (req.sessionOptions) {
    req.sessionOptions.httpOnly = true
    req.sessionOptions.sameSite = 'lax'
    req.sessionOptions.secure = isHttps(req)
    req.sessionOptions.maxAge = ttlSeconds() * 1000
  }
}

// establish <req>: the session of the user the request just signed in (req.session.jwt)
export function establish(request: object): Promise<void> {
  const req = request as SessionRequest
  const jwt = req.session?.jwt
  if (!jwt) {
    return Promise.reject(new Error('No signed-in user to start a session for'))
  }
  const sid = crypto.randomBytes(18).toString('hex')
  const expiresAt = Date.now() + ttlSeconds() * 1000
  req.session!.jwt = Object.assign({}, jwt, {sid: sid, expiresAt: expiresAt})
  harden(req)
  return dbapi.saveSession({id: sid, email: jwt.email, expiresAt: expiresAt})
}

// isActive <jwt>: whether the session of the cookie exists and has not expired
export function isActive(jwt: SessionJwt | undefined): Promise<boolean> {
  if (!jwt || !jwt.sid || !jwt.expiresAt || jwt.expiresAt <= Date.now()) {
    return Promise.resolve(false)
  }
  const sid = jwt.sid
  return dbapi.loadSession(sid).then(function(session) {
    if (!session) {
      return false
    }
    if (session.expiresAt <= Date.now()) {
      dbapi.deleteSession(sid).catch(function() {})
      return false
    }
    return true
  })
}

// The express middleware of the app and API units: answers the logout and drops the user of a
// cookie whose session is over, so the upstream auth sends the user to sign in again
export function middleware(): express.RequestHandler {
  return function(req, res, next) {
    const request = req as unknown as SessionRequest
    const jwt = request.session?.jwt

    if (req.method === 'POST' && req.path === LOGOUT_PATH) {
      const sid = jwt?.sid
      Promise.resolve(sid ? dbapi.deleteSession(sid) : null)
        .catch(function(err) {
          log.error('Unable to delete session', err)
        })
        .finally(function() {
          req.session = null
          res.status(200).json({success: true})
        })
      return
    }

    if (!jwt) {
      next()
      return
    }
    isActive(jwt)
      .then(function(active) {
        if (active) {
          harden(request)
        }
        else {
          delete request.session!.jwt
        }
        next()
      })
      .catch(next)
  }
}

// The socket.io middleware of the websocket unit, before its auth middleware
export function socketMiddleware(
  socket: {request: http.IncomingMessage}
, next: (err?: Error) => void
) {
  const request = socket.request as unknown as SessionRequest
  const jwt = request.session?.jwt
  if (!jwt) {
    next()
    return
  }
  isActive(jwt)
    .then(function(active) {
      if (!active) {
        delete request.session!.jwt
      }
      next()
    })
    .catch(next)
}

export default {
  LOGOUT_PATH
, establish
, isActive
, isFresh
, middleware
, socketMiddleware
, ttlSeconds
}
