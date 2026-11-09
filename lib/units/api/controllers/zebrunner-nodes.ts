/**
* Fork (Zebrunner): the routes of the enrolled device hosts ("nodes", ZEBRUNNER.md#nodes-enrollment),
* the paths with x-swagger-router-controller: zebrunner-nodes in lib/units/api/swagger/api_v1.yaml:
* - admin: POST /nodes/invites, GET /nodes, POST /nodes/{label}/revoke, DELETE /nodes/{label},
*   POST /nodes/verify (mcloud-grid), GET /nodes/relay (adb-relay of mcloud);
* - no authentication: POST /nodes/enroll, with an invite (stf-proxy rate limits it);
* - a signed-in user: GET /zebrunner/screen-auth, the auth_request of the screens of stf-proxy;
* - the server units (STF_STORAGE_TOKEN): GET /zebrunner/nodes/keys (triproxies),
*   POST /zebrunner/nodes/token (storage).
* Every error is a generic {"success": false}, the reason is logged; no secret is ever logged.
**/

import type {Response} from 'express'

import dbapi from '../../../db/api.js'
import {isBoundTo, type NodeDocument} from '../../../db/zebrunner-nodes.js'
import apiutil from '../../../util/apiutil.js'
import logger from '../../../util/logger.js'
import zebrunnerNodes, {
  INVITE_MAX_TTL_MINUTES
, INVITE_TTL_MINUTES
, PUBLIC_KEY
, type ScreenTarget
} from '../../../util/zebrunner-nodes.js'
import {INTERNAL_TOKEN_HEADER} from '../../../util/zebrunner-nodes-client.js'
import type {DeviceDocument} from '../../../types/stf.js'
import type {ApiRequest, NodesOptions} from '../../../types/units-api.js'

var log = logger.createLogger('api:controllers:nodes')

// lastSeenAt of a node is written at most once in this time
var LAST_SEEN_INTERVAL = 60 * 1000

type Body = Record<string, unknown>
type Request = ApiRequest<Body | undefined>

function fail(res: Response, code: number) {
  return res.status(code).json({success: false})
}

function internalError(res: Response, what: string) {
  return function(err: Error) {
    log.error('Unable to %s', what, err.stack)
    fail(res, 500)
  }
}

function nodesOptions(req: Request): NodesOptions {
  return (req.options && req.options.nodes) || {}
}

function body(req: Request): Body {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
}

function iso(date: Date | null | undefined) {
  return date ? new Date(date).toISOString() : null
}

// What a node needs to connect, null (and logged) when the API unit is not configured for the
// enrollment
function enrollmentSettings(options: NodesOptions) {
  var endpoints = options.endpoints || {}
  var missing = [
    ['--nodes-stf-url', options.stfUrl]
  , ['--nodes-connect-sub', endpoints.sub]
  , ['--nodes-connect-push', endpoints.push]
  , ['--nodes-connect-app-dealer', endpoints.appDealer]
  , ['--nodes-connect-dev-dealer', endpoints.devDealer]
  ].filter(function([, value]) {
    return !value
  }).map(function([name]) {
    return name
  })
  if (missing.length) {
    log.error('The enrollment of nodes needs the options of the API unit: %s', missing.join(', '))
    return null
  }
  return {
    serverPublicKey: options.serverPublicKey || null
  , stfUrl: options.stfUrl!
  , endpoints: {
      sub: endpoints.sub!
    , push: endpoints.push!
    , appDealer: endpoints.appDealer!
    , devDealer: endpoints.devDealer!
    }
  }
}

// The invites and enrollments of this unit run one at a time: the checks of the unique address and
// key and the invalidation of the other invites of a label are not interleaved (RethinkDB has no
// unique secondary index; the use of an invite is atomic in the database anyway)
var queue: Promise<unknown> = Promise.resolve()

export function serialized<T>(task: () => PromiseLike<T>): Promise<T> {
  var run = queue.then(task, task)
  queue = run.catch(function() {})
  return run
}

function createNodeInvite(req: Request, res: Response) {
  var fields = body(req)
  var label = fields.label as string
  var address = zebrunnerNodes.normalizeAddress(fields.address)
  var ttl = typeof fields.ttlMinutes === 'undefined' || fields.ttlMinutes === null ?
    INVITE_TTL_MINUTES :
    fields.ttlMinutes
  if (!zebrunnerNodes.isLabel(label) || !address || !Number.isInteger(ttl) || (ttl as number) < 1 ||
    (ttl as number) > INVITE_MAX_TTL_MINUTES) {
    log.warn('Refused an invite of %s: invalid label, address or ttlMinutes', req.user.email)
    return fail(res, 400)
  }
  if (!enrollmentSettings(nodesOptions(req))) {
    return fail(res, 500)
  }

  return serialized(function() {
    return dbapi.loadNodeByAddress(address!).then(function(other) {
      if (other && other.label !== label) {
        log.warn(
          'Refused an invite of node "%s": "%s" is the address of node "%s"'
        , label
        , address
        , other.label
        )
        return fail(res, 400)
      }
      var invite = zebrunnerNodes.generateInvite()
      var expiresAt = new Date(Date.now() + (ttl as number) * 60 * 1000)
      return dbapi.createNodeInvite({
        hash: zebrunnerNodes.sha256(invite)
      , label: label
      , address: address!
      , expiresAt: expiresAt
      , createdBy: req.user.email
      })
        .then(function() {
          log.important(
            'Invite of node "%s" at "%s" created by %s, valid until %s'
          , label
          , address
          , req.user.email
          , expiresAt.toISOString()
          )
          return res.status(201).json({
            invite: invite
          , label: label
          , address: address
          , expiresAt: expiresAt.toISOString()
          })
        })
    })
  })
    .catch(internalError(res, 'create an invite'))
}

function enrollNode(req: Request, res: Response) {
  var fields = body(req)
  var invite = fields.invite
  var label = fields.label
  var publicKey = fields.publicKey
  // the shapes first: a request that is not even well-formed costs nothing
  if (!zebrunnerNodes.isInvite(invite) || !zebrunnerNodes.isLabel(label) ||
    typeof publicKey !== 'string' || !PUBLIC_KEY.test(publicKey)) {
    log.warn('Refused an enrollment from %s: malformed request', req.ip)
    return fail(res, 400)
  }
  var settings = enrollmentSettings(nodesOptions(req))
  if (!settings) {
    return fail(res, 500)
  }
  var key = publicKey.toLowerCase()
  var hash = zebrunnerNodes.sha256(invite)

  function refuse(reason: string) {
    log.warn('Refused the enrollment of node "%s" from %s: %s', label, req.ip, reason)
    return fail(res, 403)
  }

  // one lookup by the hash before anything else; only the holders of an invite get further
  return dbapi.loadNodeInvite(hash)
    .then(function(found) {
      if (!found || found.usedAt || new Date(found.expiresAt).getTime() <= Date.now() ||
        found.label !== label) {
        return refuse('unknown, used or expired invite, or an invite of another label')
      }
      return serialized(function() {
        return Promise.all([dbapi.loadNodeByPublicKey(key), dbapi.loadNodeByAddress(found.address)])
          .then(function([keyNode, addressNode]) {
            if (keyNode && keyNode.label !== label) {
              return refuse(`the key is the key of node "${keyNode.label}"`)
            }
            if (addressNode && addressNode.label !== label) {
              return refuse(`the address is the address of node "${addressNode.label}"`)
            }
            return dbapi.consumeNodeInvite(hash, label as string).then(function(consumed) {
              if (!consumed) {
                return refuse('the invite was used or expired meanwhile')
              }
              var token = zebrunnerNodes.generateNodeToken(label as string)
              return dbapi.enrollNode({
                label: label as string
              , address: consumed.address
              , publicKey: key
              , tokenHash: zebrunnerNodes.sha256(token)
              })
                .then(function(node) {
                  log.important(
                    'Node "%s" at "%s" enrolled from %s (generation %d, key %s)'
                  , node.label
                  , node.address
                  , req.ip
                  , node.generation
                  , node.publicKey
                  )
                  return res.status(200).json({
                    nodeToken: token
                  , label: node.label
                  , address: node.address
                  , serverPublicKey: settings!.serverPublicKey
                  , stfUrl: settings!.stfUrl
                  , endpoints: settings!.endpoints
                  })
                })
            })
          })
      })
    })
    .catch(internalError(res, 'enroll a node'))
}

function nodeView(node: NodeDocument) {
  return {
    label: node.label
  , address: node.address
  , publicKey: node.publicKey
  , status: node.status
  , createdAt: iso(node.createdAt)
  , revokedAt: iso(node.revokedAt)
  , lastSeenAt: iso(node.lastSeenAt)
  }
}

function getNodes(req: Request, res: Response) {
  return dbapi.loadNodes()
    .then(function(nodes) {
      return res.status(200).json({nodes: nodes.map(nodeView)})
    })
    .catch(internalError(res, 'list the nodes'))
}

function labelParam(req: Request): string | null {
  var params = req.swagger.params as unknown as Record<string, {value: unknown} | undefined>
  var label = params.label && params.label.value
  return zebrunnerNodes.isLabel(label) ? label : null
}

function revokeNode(req: Request, res: Response) {
  var label = labelParam(req)
  if (!label) {
    return fail(res, 400)
  }
  return dbapi.revokeNode(label)
    .then(function(revoked) {
      if (!revoked) {
        log.warn('Refused the revocation of the unknown node "%s" by %s', label, req.user.email)
        return fail(res, 400)
      }
      log.important('Node "%s" revoked by %s', label, req.user.email)
      return res.status(200).json({success: true})
    })
    .catch(internalError(res, 'revoke a node'))
}

function deleteNode(req: Request, res: Response) {
  var label = labelParam(req)
  if (!label) {
    return fail(res, 400)
  }
  return dbapi.deleteNode(label)
    .then(function(deleted) {
      if (!deleted) {
        log.warn(
          'Refused the deletion of node "%s" by %s: unknown or not revoked'
        , label
        , req.user.email
        )
        return fail(res, 400)
      }
      log.important('Node "%s" deleted by %s', label, req.user.email)
      return res.status(200).json({success: true})
    })
    .catch(internalError(res, 'delete a node'))
}

// activeNodeOf <token>: the active node of a node token, null for any other token
function activeNodeOf(token: unknown): Promise<NodeDocument | null> {
  var label = zebrunnerNodes.tokenLabel(token)
  if (!label) {
    return Promise.resolve(null)
  }
  return Promise.resolve(dbapi.loadNode(label)).then(function(node) {
    if (!node || node.status !== 'active' ||
      !zebrunnerNodes.sameHash(zebrunnerNodes.sha256(token as string), node.tokenHash)) {
      return null
    }
    return node
  })
}

function verifyNode(req: Request, res: Response) {
  var fields = body(req)
  var host = fields.host
  return activeNodeOf(fields.token)
    .then(function(node) {
      if (!node || !zebrunnerNodes.sameAddress(host, node.address)) {
        log.warn(
          'Refused the verification of node "%s" at "%s" for %s'
        , zebrunnerNodes.tokenLabel(fields.token) || '(not a node token)'
        , typeof host === 'string' ? host.slice(0, 253) : ''
        , req.user.email
        )
        return fail(res, 403)
      }
      dbapi.touchNode(node.label, LAST_SEEN_INTERVAL).catch(function(err: Error) {
        log.error('Unable to update the last time node "%s" was seen', node.label, err.stack)
      })
      return res.status(200).json({label: node.label, address: node.address})
    })
    .catch(internalError(res, 'verify a node'))
}

function getNodeRelay(req: Request, res: Response) {
  return dbapi.loadRelayDevices()
    .then(function(devices) {
      return res.status(200).json({devices: devices})
    })
    .catch(internalError(res, 'list the devices of the relay'))
}

// The internal routes take the token of the server units only, never a node token
function internalCaller(req: Request, res: Response): boolean {
  var given = req.headers[INTERNAL_TOKEN_HEADER]
  if (zebrunnerNodes.sameSecret(given, nodesOptions(req).internalToken)) {
    return true
  }
  log.warn(
    'Refused the internal route %s to %s: not the token of the server units'
  , req.path
  , req.ip
  )
  fail(res, 403)
  return false
}

function getNodeKeys(req: Request, res: Response) {
  if (!internalCaller(req, res)) {
    return null
  }
  return dbapi.loadNodeKeys()
    .then(function(keys) {
      return res.status(200).json(keys)
    })
    .catch(internalError(res, 'list the keys of the nodes'))
}

function checkNodeToken(req: Request, res: Response) {
  if (!internalCaller(req, res)) {
    return null
  }
  return activeNodeOf(body(req).token)
    .then(function(node) {
      if (!node) {
        return fail(res, 403)
      }
      return res.status(200).json({label: node.label})
    })
    .catch(internalError(res, 'check a node token'))
}

// legacyScreenMatches <device> <target>: the screen of a device of a legacy host is its own: the
// port is its screen port and its screen URL has the host, serial and port of the target
function legacyScreenMatches(device: DeviceDocument, target: ScreenTarget): boolean {
  var hasPort = typeof device.screenPort === 'number'
  if (hasPort && device.screenPort !== target.port) {
    return false
  }
  var url = device.display && device.display.url
  if (!url) {
    return hasPort
  }
  try {
    var own = zebrunnerNodes.parseScreenUri(new URL(url).pathname)
    return Boolean(own && own.host === target.host && own.serial === target.serial &&
      own.port === target.port)
  }
  catch (err) {
    return false
  }
}

export interface ScreenDecision {
  allowed: boolean
  reason: string
}

// screenDecision <user> <target> <lookups>: whether the user may open the screen of the target
export function screenDecision(
  user: {email: string, privilege: string}
, target: ScreenTarget | null
, device: DeviceDocument | null
, node: NodeDocument | null
, hostNode: NodeDocument | null
, agentHosts: string[]
): ScreenDecision {
  if (!target) {
    return {allowed: false, reason: 'not a screen URI'}
  }
  if (!device) {
    return {allowed: false, reason: 'unknown device'}
  }
  if (user.privilege !== apiutil.ADMIN && !(device.owner && device.owner.email === user.email)) {
    return {allowed: false, reason: 'the device is not used by the user'}
  }
  if (isBoundTo(device, node)) {
    if (!zebrunnerNodes.sameAddress(node.address, target.host)) {
      return {allowed: false, reason: `the host is not the address of node "${node.label}"`}
    }
    if (device.screenPort !== target.port) {
      return {allowed: false, reason: 'not the screen port of the device'}
    }
    return {allowed: true, reason: `bound to node "${node.label}"`}
  }
  if (agentHosts.indexOf(target.host) === -1) {
    return {allowed: false, reason: 'unbound device, the host is not in AGENT_HOSTS'}
  }
  if (hostNode) {
    return {
      allowed: false
    , reason: `unbound device, the host is the address of node "${hostNode.label}"`
    }
  }
  if (!legacyScreenMatches(device, target)) {
    return {allowed: false, reason: 'unbound device, not its screen'}
  }
  return {allowed: true, reason: 'legacy host'}
}

function getScreenAuth(req: Request, res: Response) {
  var user = req.user
  if (!user) {
    return res.status(401).end()
  }
  var uri = req.headers['x-original-uri']
  var target = zebrunnerNodes.parseScreenUri(uri)

  var agentHosts = nodesOptions(req).agentHosts || []

  function decide(
    device: DeviceDocument | null
  , node: NodeDocument | null
  , hostNode: NodeDocument | null
  ) {
    var decision = screenDecision(user, target, device, node, hostNode, agentHosts)
    if (!decision.allowed) {
      log.warn(
        'Refused the screen %s to %s: %s'
      , typeof uri === 'string' ? uri.slice(0, 300) : '(no X-Original-URI)'
      , user.email
      , decision.reason
      )
      return res.status(403).end()
    }
    return res.status(204).end()
  }

  if (!target) {
    return decide(null, null, null)
  }
  return dbapi.loadDeviceBySerial(target.serial)
    .then(function(device) {
      return Promise.all([
        device && device.node ? dbapi.loadNode(device.node) : null
      , dbapi.loadNodeByAddress(target!.host)
      ])
        .then(function([node, hostNode]) {
          return decide(device, node, hostNode)
        })
    })
    .catch(internalError(res, 'check a screen'))
}

export {
  checkNodeToken
, createNodeInvite
, deleteNode
, enrollNode
, getNodeKeys
, getNodeRelay
, getNodes
, getScreenAuth
, revokeNode
, verifyNode
}
