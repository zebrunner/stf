/**
* SSRF protection helper (SLV-002).
*
* Validates that a user-supplied URL uses an allowed scheme and does not resolve
* to a private, loopback, link-local, metadata, or otherwise restricted address.
* Validation happens AFTER DNS resolution, so a public hostname that resolves to
* an internal address is still rejected.
*/
var dns = require('dns')
var net = require('net')
var url = require('url')

var Promise = require('bluebird')
var requtil = require('./requtil')

// Blocked IPv4 ranges as [network, prefixBits].
var BLOCKED_V4 = [
  ['0.0.0.0', 8]         // "this" network / unspecified
, ['10.0.0.0', 8]        // RFC1918 private
, ['100.64.0.0', 10]     // CGNAT
, ['127.0.0.0', 8]       // loopback
, ['169.254.0.0', 16]    // link-local (incl. cloud metadata 169.254.169.254)
, ['172.16.0.0', 12]     // RFC1918 private
, ['192.0.0.0', 24]      // IETF protocol assignments
, ['192.0.2.0', 24]      // TEST-NET-1
, ['192.168.0.0', 16]    // RFC1918 private
, ['198.18.0.0', 15]     // benchmarking
, ['198.51.100.0', 24]   // TEST-NET-2
, ['203.0.113.0', 24]    // TEST-NET-3
, ['224.0.0.0', 4]       // multicast
, ['240.0.0.0', 4]       // reserved
, ['255.255.255.255', 32] // broadcast
]

function ipv4ToLong(ip) {
  return ip.split('.').reduce(function(acc, octet) {
    return ((acc << 8) >>> 0) + (parseInt(octet, 10) & 255)
  }, 0) >>> 0
}

function inCidr(ip, network, bits) {
  var mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(network) & mask)
}

function isBlockedIPv4(ip) {
  return BLOCKED_V4.some(function(entry) {
    return inCidr(ip, entry[0], entry[1])
  })
}

function isBlockedIPv6(ip) {
  var addr = ip.toLowerCase()
  if (addr === '::1' || addr === '::') {
    return true
  }
  // IPv4-mapped (::ffff:a.b.c.d) -> validate the embedded IPv4.
  var mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) {
    return isBlockedIPv4(mapped[1])
  }
  var head = addr.split(':')[0]
  if (/^f[cd]/.test(head)) {   // fc00::/7 unique-local
    return true
  }
  if (/^fe[89ab]/.test(head)) { // fe80::/10 link-local
    return true
  }
  if (/^ff/.test(head)) {       // ff00::/8 multicast
    return true
  }
  return false
}

function isBlockedIp(ip) {
  var kind = net.isIP(ip)
  if (kind === 4) {
    return isBlockedIPv4(ip)
  }
  if (kind === 6) {
    return isBlockedIPv6(ip)
  }
  return true // not a recognizable IP -> refuse
}

function blocked(msg) {
  return new requtil.ValidationError('validation error', [
    {param: 'url', msg: msg}
  ])
}

// Resolve and validate a URL. Resolves with the list of safe IPs, or rejects
// with a requtil.ValidationError (so callers return HTTP 400).
function assertSafeUrl(rawUrl) {
  return Promise.try(function() {
    var parsed
    try {
      parsed = new url.URL(rawUrl)
    }
    catch (err) {
      throw blocked('Invalid URL')
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw blocked('Only http and https URLs are allowed')
    }

    var host = parsed.hostname
    if (!host) {
      throw blocked('URL host is empty')
    }

    if (net.isIP(host)) {
      if (isBlockedIp(host)) {
        throw blocked('URL resolves to a restricted address')
      }
      return [host]
    }

    return Promise.fromCallback(function(cb) {
      dns.lookup(host, {all: true}, cb)
    })
    .then(function(records) {
      if (!records || !records.length) {
        throw blocked('Unable to resolve host')
      }
      records.forEach(function(record) {
        if (isBlockedIp(record.address)) {
          throw blocked('URL resolves to a restricted address')
        }
      })
      return records.map(function(record) {
        return record.address
      })
    })
  })
}

// dns.lookup wrapper that refuses to hand back a restricted address. Passed to
// the HTTP client so the guarantee holds at actual connect time (also on
// redirects), mitigating DNS-rebinding between validation and connection.
function guardedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  dns.lookup(hostname, options, function(err, address, family) {
    if (err) {
      return callback(err)
    }
    var addresses = Array.isArray(address)
      ? address.map(function(a) {
          return a.address
        })
      : [address]
    for (var i = 0; i < addresses.length; i++) {
      if (isBlockedIp(addresses[i])) {
        return callback(new Error('Refusing to connect to restricted address: ' + addresses[i]))
      }
    }
    callback(null, address, family)
  })
}

module.exports.isBlockedIp = isBlockedIp
module.exports.assertSafeUrl = assertSafeUrl
module.exports.guardedLookup = guardedLookup
