/**
* Fork (Zebrunner): the auth_request of the grid of MCloud (ZEBRUNNER.md#grid-authentication),
* GET /zebrunner/hub-auth?scope=hub|console|admin, the path with x-swagger-router-controller:
* zebrunner-hub-auth in lib/units/api/swagger/api_v1.yaml.
*
* stf-proxy asks it before every request of the grid (/mcloud): 204 lets the request in with the user
* in the X-MCloud-* headers of the answer, which stf-proxy passes on to the grid; 401 and 403 refuse
* it. The credential is an access token of the user (Authorization: Basic <any name>:<token>, the
* user info of the hub URL of a test, or Bearer <token>); the console and the admin routes also take
* the session cookie of a signed-in user. The hub never takes the cookie: a page of another site
* would start sessions with it.
*
* stf-proxy asks for every WebDriver command, so a user of a token is kept for CACHE_TTL_MS: a
* removed token or a changed privilege is seen after that time at most. No token is ever logged.
**/

import crypto from 'crypto'

import type {Response} from 'express'

import dbapi from '../../../db/api.js'
import apiutil from '../../../util/apiutil.js'
import jwtutil from '../../../util/jwtutil.js'
import logger from '../../../util/logger.js'
import type {ApiRequest} from '../../../types/units-api.js'

var log = logger.createLogger('api:controllers:hub-auth')

export var CACHE_TTL_MS = 30 * 1000
// the tokens come from the requests: the cache does not grow without a limit
export var CACHE_MAX_ENTRIES = 10000

export var SCOPES = ['hub', 'console', 'admin']

export interface HubUser {
  email: string
  admin: boolean
}

interface Cached {
  user: HubUser
  until: number
}

var cache = new Map<string, Cached>()

type Request = ApiRequest<unknown> & {
  session?: {jwt?: {email?: string}} | null
}

// credentialToken <Authorization header>: the access token of Basic <name>:<token> or Bearer <token>
export function credentialToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null
  }
  var match = /^(Basic|Bearer)\s+(\S+)\s*$/i.exec(header)
  if (!match) {
    return null
  }
  if (match[1]!.toLowerCase() === 'bearer') {
    return match[2]!
  }
  var decoded = Buffer.from(match[2]!, 'base64').toString('utf8')
  var colon = decoded.indexOf(':')
  var token = colon < 0 ? '' : decoded.slice(colon + 1)
  return token.length > 0 ? token : null
}

function cacheKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function hubUser(user: {email: string, privilege: string}): HubUser {
  return {email: user.email, admin: user.privilege === apiutil.ADMIN}
}

// userOfToken <token> <secret>: the user of an access token, null for an unknown token or user
function userOfToken(token: string, secret: string): Promise<HubUser | null> {
  var key = cacheKey(token)
  var now = Date.now()
  var cached = cache.get(key)
  if (cached && cached.until > now) {
    return Promise.resolve(cached.user)
  }
  cache.delete(key)
  return Promise.resolve(dbapi.loadAccessToken(token))
    .then(function(stored) {
      var data = stored && stored.jwt ? jwtutil.decode(stored.jwt, secret) : null
      if (!data || typeof data.email !== 'string') {
        return null
      }
      return Promise.resolve(dbapi.loadUser(data.email)).then(function(user) {
        if (!user) {
          return null
        }
        var found = hubUser(user)
        if (cache.size >= CACHE_MAX_ENTRIES) {
          cache.clear()
        }
        cache.set(key, {user: found, until: Date.now() + CACHE_TTL_MS})
        return found
      })
    })
}

// userOfSession <request>: the signed-in user of the session cookie, null without one
function userOfSession(req: Request): Promise<HubUser | null> {
  var email = req.session && req.session.jwt && req.session.jwt.email
  if (typeof email !== 'string') {
    return Promise.resolve(null)
  }
  return Promise.resolve(dbapi.loadUser(email)).then(function(user) {
    return user ? hubUser(user) : null
  })
}

function scopeOf(req: Request): string | null {
  var param = req.swagger && req.swagger.params && req.swagger.params.scope
  var scope = param && typeof param.value === 'string' ? param.value : 'hub'
  return SCOPES.indexOf(scope) >= 0 ? scope : null
}

// Forgets the users of the tokens, for tests
export function clearCache() {
  cache.clear()
}

function getHubAuth(req: Request, res: Response) {
  var scope = scopeOf(req)
  if (!scope) {
    return res.status(400).end()
  }
  var token = credentialToken(req.headers.authorization)
  var found: Promise<HubUser | null>
  if (token) {
    found = userOfToken(token, req.options.secret)
  }
  else if (scope !== 'hub') {
    found = userOfSession(req)
  }
  else {
    found = Promise.resolve(null)
  }
  return found
    .then(function(user) {
      if (!user) {
        log.warn(
          'Refused the grid (%s) to %s: %s'
        , scope
        , req.ip
        , token ? 'invalid access token' : 'no access token'
        )
        return res.status(401).end()
      }
      if (scope === 'admin' && !user.admin) {
        log.warn('Refused the admin routes of the grid to %s: not an admin', user.email)
        return res.status(403).end()
      }
      res.set('X-MCloud-User', user.email)
      res.set('X-MCloud-Admin', String(user.admin))
      if (token) {
        res.set('X-MCloud-Token', token)
      }
      return res.status(204).end()
    })
    .catch(function(err: Error) {
      log.error('Unable to check a user of the grid', err.stack)
      res.status(500).end()
    })
}

export {
  getHubAuth
}
