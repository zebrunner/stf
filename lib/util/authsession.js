/**
* Auth session handoff helper (SLV-003).
*
* Establishes the STF browser session through the signed `ssid` cookie that the
* auth, app, api, and websocket units already share, instead of returning the
* JWT in a redirect URL. The token therefore never appears in browser history,
* server/proxy logs, referrer headers, or shared links.
*/
var dbapi = require('../db/api')

// isHttps reports whether the external client request arrived over TLS. The
// edge proxy terminates TLS, so honour X-Forwarded-Proto as well as req.secure.
function isHttps(req) {
  if (req.secure) {
    return true
  }
  var proto = req.headers && req.headers['x-forwarded-proto']
  if (!proto) {
    return false
  }
  return String(proto).split(',')[0].trim().toLowerCase() === 'https'
}

// harden pins the session cookie to same-site browser use and marks it Secure
// whenever the request arrived over TLS.
function harden(req) {
  if (!req.sessionOptions) {
    return
  }
  req.sessionOptions.sameSite = 'lax'
  req.sessionOptions.secure = isHttps(req)
  // The frontend logout clears `ssid` from JavaScript, so it stays non-httpOnly.
  req.sessionOptions.httpOnly = false
}

// establish records the authenticated identity in the shared session cookie and
// persists the login. Returns a promise so callers redirect only once the user
// row exists and the app unit can load it.
function establish(req, identity) {
  req.session.jwt = {
    email: identity.email
  , name: identity.name
  }
  harden(req)
  return dbapi.saveUserAfterLogin({
    name: identity.name
  , email: identity.email
  , ip: req.ip
  })
}

module.exports.isHttps = isHttps
module.exports.harden = harden
module.exports.establish = establish
