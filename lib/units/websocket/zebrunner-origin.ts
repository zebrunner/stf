/**
* Fork (Zebrunner): the Origin check of the WebSocket of the UI (ZEBRUNNER.md#websocket-origin).
*
* The session cookie is SameSite=Lax, so any page of the same site (another subdomain) could open the
* socket with the cookie of a signed-in user and act as that user (e.g. make an access token). A
* browser sends Origin with every WebSocket handshake, so the handshake is refused when its Origin is
* none of:
* - an origin of --allowed-origin;
* - the origin of --storage-url (the public URL of STF in mcloud);
* - the host the request was sent to (Host), whatever the scheme (TLS may end before the unit).
* A handshake without Origin is not of a browser (a script, a test), which has no cookie of a victim
* to use, so it goes on to the authentication of the session as before.
**/

import type {IncomingHttpHeaders} from 'http'

// originOf <url>: the origin of a URL (scheme, host and a port other than the default), lower case;
// null for no URL, an opaque origin ("null") or one that is not http(s)
export function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) {
    return null
  }
  try {
    var parsed = new URL(url.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.origin.toLowerCase()
  }
  catch {
    return null
  }
}

// allowedOrigins <origins> <storageUrl>: the configured origins and the one of the storage URL
export function allowedOrigins(origins: string[] | undefined, storageUrl?: string): Set<string> {
  var allowed = new Set<string>()
  ;(origins || []).concat(storageUrl ? [storageUrl] : []).forEach(function(url) {
    var origin = originOf(url)
    if (origin) {
      allowed.add(origin)
    }
  })
  return allowed
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// originRefusal <headers> <allowed>: why the Origin of a handshake is refused, null when it is not
export function originRefusal(headers: IncomingHttpHeaders, allowed: Set<string>): string | null {
  var given = first(headers.origin)
  if (typeof given === 'undefined' || given === '') {
    return null
  }
  var origin = originOf(given)
  if (!origin) {
    return 'an Origin that is not of a web page'
  }
  if (allowed.has(origin)) {
    return null
  }
  var host = first(headers.host)
  if (host) {
    var target = originOf(new URL(origin).protocol + '//' + host.trim())
    if (target && new URL(target).host === new URL(origin).host) {
      return null
    }
  }
  return 'an Origin of another site'
}

export default {originOf, allowedOrigins, originRefusal}
