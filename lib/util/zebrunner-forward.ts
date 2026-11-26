// Fork (Zebrunner): the targets of the port forwarding of a device (lib/units/device/plugins/forward). The provider
// connects to the host and the port a user gives, from the network of the node: a public address only, unless the
// deployment allows networks in STF_FORWARD_ALLOW (e.g. the LAN of its users), so a user cannot reach the services of
// the node, its docker networks, its LAN or the metadata of a cloud through a forward.
import type net from 'net'

import logger from './logger.js'
import urlsafety from './urlsafety.js'

const log = logger.createLogger('util:zebrunner-forward')

// STF_FORWARD_ALLOW: the networks a forward may reach besides the public addresses, `10.1.2.0/24` or `10.1.2.3`,
// separated by commas or spaces
export const FORWARD_ALLOW = 'STF_FORWARD_ALLOW'

// forwardAllowList [env]: the allowed networks; an invalid value allows none (logged)
export function forwardAllowList(env: NodeJS.ProcessEnv = process.env): net.BlockList {
  const entries = (env[FORWARD_ALLOW] || '').split(/[\s,]+/).filter(Boolean)
  try {
    return urlsafety.createAllowList(entries)
  }
  catch (err) {
    log.error(
      '%s is invalid, the forwards reach the public addresses only: %s'
    , FORWARD_ALLOW
    , (err as Error).message
    )
    return urlsafety.createAllowList([])
  }
}

let allowList: net.BlockList | null = null

// forwardConnect <target>: the connection of a forward to its target, refused (an error of the socket) for a target
// that is not public nor allowed
export function forwardConnect(target: {targetHost: string, targetPort: number}): net.Socket {
  if (!allowList) {
    allowList = forwardAllowList()
  }
  const sock = urlsafety.safeConnect({
    host: target.targetHost
  , port: target.targetPort
  }, allowList)
  sock.on('error', function(err) {
    if (/^Refusing/.test(err.message)) {
      log.warn(
        'Refused the forward to %s:%d: %s'
      , target.targetHost
      , target.targetPort
      , err.message
      )
    }
  })
  return sock
}

export default {FORWARD_ALLOW, forwardAllowList, forwardConnect}
