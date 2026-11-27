/**
* Fork (Zebrunner): the cookies of STF of the units that set them (app, auth-*, api).
*
* The session cookie (options.ssid) is HttpOnly (the UI reads XSRF-TOKEN only) and SameSite=Lax (no
* cross-site POST, fetch or WebSocket of another site gets it). Both cookies are Secure when the public
* URL of the unit (--auth-url of the app, --app-url of the sign-ins, --nodes-stf-url of the API) is
* https, whatever the headers of the request; otherwise when the request came over https (TLS to the
* unit, or X-Forwarded-Proto: https of the proxy that ends TLS). A header only adds the flag: a client
* cannot drop it with X-Forwarded-Proto: http.
*
* The client address: the units behind stf-proxy trust X-Forwarded-For of one hop only, a peer of a
* private network (trustProxy), so req.ip is the address the proxy saw, never one the client wrote.
**/

import type {IncomingHttpHeaders} from 'http'

import type {NextFunction, Request, RequestHandler, Response} from 'express'
import cookieSession from 'cookie-session'
import proxyaddr from 'proxy-addr'

// isHttps <request>: the request came over https, to the unit or to the proxy in front of it
export function isHttps(req: {headers: IncomingHttpHeaders, socket?: object}): boolean {
  var proto = req.headers['x-forwarded-proto']
  var first = ((Array.isArray(proto) ? proto[0] : proto) || '').split(',')[0]!.trim().toLowerCase()
  var socket = req.socket as {encrypted?: boolean} | undefined
  return first === 'https' || Boolean(socket && socket.encrypted)
}

// isHttpsUrl <url>: the configured public URL is https
export function isHttpsUrl(url: string | undefined): boolean {
  return /^https:\/\//i.test((url || '').trim())
}

// isSecure <request> <publicUrl>: the cookies of the request get the Secure flag
export function isSecure(
  req: {headers: IncomingHttpHeaders, socket?: object}
, publicUrl?: string
): boolean {
  return isHttpsUrl(publicUrl) || isHttps(req)
}

var privateNetworks = proxyaddr.compile(['loopback', 'linklocal', 'uniquelocal'])

// trustProxy <address> <hop>: the 'trust proxy' of express and of proxy-addr: the direct peer only (one
// hop), and only from a private network (stf-proxy in the docker network): a client reaching the unit
// directly, or an X-Forwarded-For the client wrote before the proxy, is never taken as its address
export function trustProxy(address: string, hop: number): boolean {
  return hop === 0 && privateNetworks(address, hop)
}

// sessionCookie <name> <secret> [publicUrl] [options]: options.maxAge, the lifetime of the cookie in ms
// (none: a cookie of the browser session)
export function sessionCookie(
  name: string
, secret: string
, publicUrl?: string
, options: {maxAge?: number} = {}
) {
  var session = cookieSession(Object.assign({
    name: name
  , keys: [secret]
  , httpOnly: true
  , sameSite: 'lax' as const
  }, options))
  return function(req: Request, res: Response, next: NextFunction) {
    var secure = isSecure(req, publicUrl)
    if (secure && req.protocol !== 'https') {
      // TLS ends before the unit: the cookies of the request are the ones of https (the Secure flag is allowed)
      Object.defineProperty(req, 'protocol', {value: 'https', configurable: true})
    }
    session(req, res, function(err?: unknown) {
      if (!err && req.sessionOptions && secure) {
        req.sessionOptions.secure = true
      }
      next(err as Error | undefined)
    })
  }
}

// xsrfCookie <publicUrl>: the XSRF-TOKEN cookie of the double-submit token of the UI (after csrf()),
// readable by the scripts of the UI, Secure as the session cookie
export function xsrfCookie(publicUrl?: string): RequestHandler {
  return function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken(), {secure: isSecure(req, publicUrl), sameSite: 'lax'})
    next()
  }
}

export default {isHttps, isHttpsUrl, isSecure, trustProxy, sessionCookie, xsrfCookie}
