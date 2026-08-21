var fs = require('fs')
var net = require('net')
var url = require('url')
var Promise = require('bluebird')
var request = require('request')
var progress = require('request-progress')
var temp = require('temp')
var urlsafety = require('./urlsafety')

// Allow a redirect only to http/https and never straight to a literal internal
// IP. Hostname redirects are additionally guarded at connect time by
// urlsafety.guardedLookup below.
function safeFollowRedirect(response) {
  try {
    var location = response.headers && response.headers.location
    if (!location) {
      return true
    }
    var base = response.request && response.request.href
    var next = base ? new url.URL(location, base) : new url.URL(location)
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      return false
    }
    if (net.isIP(next.hostname) && urlsafety.isBlockedIp(next.hostname)) {
      return false
    }
    return true
  }
  catch (err) {
    return false
  }
}

module.exports = function download(url, options) {
  options = options || {}
  var resolver = Promise.defer()
  var path = temp.path(options)

  function errorListener(err) {
    resolver.reject(err)
  }

  function progressListener(state) {
    if (state.total !== null) {
      resolver.progress({
        lengthComputable: true
      , loaded: state.received
      , total: state.total
      })
    }
    else {
      resolver.progress({
        lengthComputable: false
      , loaded: state.received
      , total: state.received
      })
    }
  }

  function closeListener() {
    resolver.resolve({
      path: path
    })
  }

  resolver.progress({
    percent: 0
  })

  try {
    // SSRF protection is opt-in (ssrfProtect) so it only applies to untrusted,
    // user-supplied URLs. Trusted internal callers (e.g. the APK manifest
    // plugin fetching from storageUrl) intentionally skip it.
    var requestOptions = {}
    if (options.ssrfProtect) {
      requestOptions.lookup = urlsafety.guardedLookup
      requestOptions.followRedirect = safeFollowRedirect
      requestOptions.maxRedirects = 5
    }
    if (options.headers) {
      requestOptions.headers = options.headers
    }

    var req = progress(request(url, requestOptions), {
        throttle: 100 // Throttle events, not upload speed
      })
      .on('progress', progressListener)

    resolver.promise.finally(function() {
      req.removeListener('progress', progressListener)
    })

    var save = req.pipe(fs.createWriteStream(path))
      .on('error', errorListener)
      .on('close', closeListener)

    resolver.promise.finally(function() {
      save.removeListener('error', errorListener)
      save.removeListener('close', closeListener)
    })
  }
  catch (err) {
    resolver.reject(err)
  }

  return resolver.promise
}
