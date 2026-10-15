/**
* Fork (Zebrunner): SSRF protection of the URLs users ask the storage units to download.
*
* A URL is accepted when it is http(s) and every address its host resolves to is public, or is in
* the networks the deployment allows explicitly. The addresses are checked again when the socket
* connects (DNS rebinding) and on every redirect.
**/

import dns from 'dns'
import net from 'net'

import Promise from 'bluebird'
import type request from '@cypress/request'

import download from './download.js'
import requtil from './requtil.js'

type Family = 'ipv4' | 'ipv6'

const RESTRICTED: Array<[string, number, Family]> = [
  ['0.0.0.0', 8, 'ipv4']
, ['10.0.0.0', 8, 'ipv4']
, ['100.64.0.0', 10, 'ipv4']
, ['127.0.0.0', 8, 'ipv4']
, ['169.254.0.0', 16, 'ipv4']
, ['172.16.0.0', 12, 'ipv4']
, ['192.0.0.0', 24, 'ipv4']
, ['192.0.2.0', 24, 'ipv4']
, ['192.88.99.0', 24, 'ipv4']
, ['192.168.0.0', 16, 'ipv4']
, ['198.18.0.0', 15, 'ipv4']
, ['198.51.100.0', 24, 'ipv4']
, ['203.0.113.0', 24, 'ipv4']
, ['224.0.0.0', 4, 'ipv4']
, ['240.0.0.0', 4, 'ipv4']
  // IPv4-compatible, loopback and unspecified; IPv4-mapped addresses are checked as IPv4
, ['::', 96, 'ipv6']
, ['64:ff9b::', 96, 'ipv6']
, ['64:ff9b:1::', 48, 'ipv6']
, ['100::', 64, 'ipv6']
, ['2001::', 32, 'ipv6']
, ['2001:db8::', 32, 'ipv6']
, ['2002::', 16, 'ipv6']
, ['fc00::', 7, 'ipv6']
, ['fe80::', 10, 'ipv6']
, ['ff00::', 8, 'ipv6']
]

const restricted = new net.BlockList()
RESTRICTED.forEach(function([network, prefix, family]) {
  restricted.addSubnet(network, prefix, family)
})

function familyOf(address: string): Family | null {
  switch (net.isIP(address)) {
  case 4:
    return 'ipv4'
  case 6:
    return 'ipv6'
  default:
    return null
  }
}

// allowed: the networks of the deployment that may be downloaded from, as `10.1.2.0/24` or `10.1.2.3`
function createAllowList(allowed: string[] = []) {
  const list = new net.BlockList()
  allowed.forEach(function(entry) {
    const [network, prefix] = entry.trim().split('/')
    const family = familyOf(network!)
    if (!family) {
      throw new Error(`Invalid network "${entry}"`)
    }
    if (typeof prefix === 'undefined') {
      list.addAddress(network!, family)
    }
    else {
      list.addSubnet(network!, Number(prefix), family)
    }
  })
  return list
}

function isRestricted(address: string, allowList?: net.BlockList): boolean {
  const family = familyOf(address)
  if (!family) {
    return true
  }
  if (allowList && allowList.check(address, family)) {
    return false
  }
  return restricted.check(address, family)
}

type RejectionCtor = new(message: string, errors: Array<{param: string, msg: string}>) => Error

// A requtil.ValidationError, which the storage units answer with HTTP 400
function rejection(msg: string) {
  return new (requtil.ValidationError as unknown as RejectionCtor)('validation error', [
    {param: 'url', msg: msg}
  ])
}

function hostOf(parsed: URL) {
  return parsed.hostname.replace(/^\[(.*)\]$/, '$1')
}

function resolve(host: string) {
  if (familyOf(host)) {
    return Promise.resolve([host])
  }
  return new Promise<string[]>(function(resolve, reject) {
    dns.lookup(host, {all: true}, function(err, records) {
      if (err || !records.length) {
        reject(rejection('Unable to resolve host'))
      }
      else {
        resolve(records.map(function(record) {
          return record.address
        }))
      }
    })
  })
}

// Resolves with the addresses of the URL, rejects with a requtil.ValidationError (HTTP 400)
function assertSafeUrl(rawUrl: string, allowList?: net.BlockList) {
  return Promise.try(function() {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    }
    catch {
      throw rejection('Invalid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw rejection('Only http and https URLs are allowed')
    }
    return resolve(hostOf(parsed))
  })
    .then(function(addresses) {
      if (addresses.some(function(address) {
        return isRestricted(address, allowList)
      })) {
        throw rejection('URL resolves to a restricted address')
      }
      return addresses
    })
}

// The options of @cypress/request that keep the checks of assertSafeUrl for the connection
function requestOptions(allowList?: net.BlockList): request.CoreOptions {
  function lookup(
    hostname: string
  , options: dns.LookupOptions
  , callback: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void
  ) {
    dns.lookup(hostname, {...options, all: true}, function(err, records) {
      if (err) {
        return callback(err, '')
      }
      const denied = records.find(function(record) {
        return isRestricted(record.address, allowList)
      })
      if (denied || !records.length) {
        return callback(new Error(`Refusing a restricted address of "${hostname}"`), '')
      }
      if (options.all) {
        return callback(null, records)
      }
      return callback(null, records[0]!.address, records[0]!.family)
    })
  }

  // The lookup is skipped for literal addresses, so a redirect to one is checked here
  function followRedirect(response: request.Response) {
    const location = response.headers.location
    if (!location) {
      return true
    }
    try {
      const target = new URL(location, response.request.uri.href)
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return false
      }
      const host = hostOf(target)
      return !familyOf(host) || !isRestricted(host, allowList)
    }
    catch {
      return false
    }
  }

  return {
    lookup: lookup
  , followRedirect: followRedirect
  , maxRedirects: 5
  }
}

// download() of a URL a user asked for; allowed: see createAllowList
function safeDownload(url: string, options: Parameters<typeof download>[1], allowed?: string[]) {
  const allowList = createAllowList(allowed)
  return assertSafeUrl(url, allowList)
    .then(function() {
      return download(url, options, requestOptions(allowList))
    })
}

export default {
  assertSafeUrl
, createAllowList
, isRestricted
, requestOptions
, download: safeDownload
}
