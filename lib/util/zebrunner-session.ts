/**
* Fork (Zebrunner): the session cookie of STF (options.ssid) of the units that set it (app, auth-*, api):
* HttpOnly (the UI reads XSRF-TOKEN only), SameSite=Lax (no cross-site POST, fetch or WebSocket of another
* site gets it) and Secure for the https requests, the ones stf-proxy forwards with X-Forwarded-Proto: https.
**/

import type {IncomingHttpHeaders} from 'http'

import type {NextFunction, Request, Response} from 'express'
import cookieSession from 'cookie-session'

// isHttps <request>: the request came over https, to the unit or to the proxy in front of it
export function isHttps(req: {headers: IncomingHttpHeaders, socket?: object}): boolean {
  var proto = req.headers['x-forwarded-proto']
  var first = ((Array.isArray(proto) ? proto[0] : proto) || '').split(',')[0]!.trim().toLowerCase()
  var socket = req.socket as {encrypted?: boolean} | undefined
  return first === 'https' || Boolean(socket && socket.encrypted)
}

export function sessionCookie(name: string, secret: string) {
  var session = cookieSession({
    name: name
  , keys: [secret]
  , httpOnly: true
  , sameSite: 'lax'
  })
  return function(req: Request, res: Response, next: NextFunction) {
    var https = isHttps(req)
    if (https && req.protocol !== 'https') {
      // stf-proxy ends TLS: the cookies of the request are the ones of https (the Secure flag is allowed)
      Object.defineProperty(req, 'protocol', {value: 'https', configurable: true})
    }
    session(req, res, function(err?: unknown) {
      if (!err && req.sessionOptions && https) {
        req.sessionOptions.secure = true
      }
      next(err as Error | undefined)
    })
  }
}

export default {isHttps, sessionCookie}
