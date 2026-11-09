/**
* Fork (Zebrunner): the database methods of the enrolled device hosts ("nodes",
* ZEBRUNNER.md#nodes-enrollment): the `nodes` and `node_invites` tables of lib/db/tables.ts and the
* node binding of the devices. lib/db/zebrunner.ts adds them to dbapi.
**/

import r from 'rethinkdb'
import Promise from 'bluebird'

type DbApi = typeof import('./api.js')['default']
type Db = typeof import('./index.js')['default']

export type NodeStatus = 'active' | 'revoked'

export interface NodeDocument {
  label: string
  // lower case, unique among the nodes
  address: string
  // the CURVE public key of the node, lower case hex
  publicKey: string
  // sha256 hex of the node token
  tokenHash: string
  status: NodeStatus
  createdAt: Date
  revokedAt: Date | null
  lastSeenAt: Date | null
  // +1 on every re-enrollment (rotation); the devices bound with an older token are unbound
  generation: number
  // the keys of the previous enrollments of the node, refused by the triproxies even if a legacy
  // variable has them
  retiredKeys?: string[]
}

export interface NodeInviteDocument {
  hash: string
  label: string
  address: string
  expiresAt: Date
  usedAt: Date | null
  createdBy: string
  createdAt: Date
}

export interface NodeKeys {
  allowed: string[]
  denied: string[]
}

export interface RelayDevice {
  serial: string
  label: string
  address: string
  connectPort: number
}

// The node of a device: the label and the generation of the token its registration was proved with
export interface NodeBinding {
  node: string | null
  nodeGeneration: number | null
}

export const UNBOUND: NodeBinding = {node: null, nodeGeneration: null}

const RETIRED_KEYS = 10

type InviteRow = r.Expression<NodeInviteDocument>
type NodeRow = r.Expression<NodeDocument>
type WriteResultOf<T> = r.WriteResult & {changes?: Array<{new_val: T}>}

interface BoundDevice {
  serial: string
  node: string
  nodeGeneration: number
  connectPort?: number
}

export interface NodesDbApi {
  createNodeInvite(invite: Omit<NodeInviteDocument, 'usedAt' | 'createdAt'>): Promise<void>
  loadNodeInvite(hash: string): Promise<NodeInviteDocument | null>
  consumeNodeInvite(hash: string, label: string): Promise<NodeInviteDocument | null>
  loadNode(label: string): Promise<NodeDocument | null>
  loadNodes(): Promise<NodeDocument[]>
  loadNodeByAddress(address: string): Promise<NodeDocument | null>
  loadNodeByPublicKey(publicKey: string): Promise<NodeDocument | null>
  enrollNode(
    fields: Pick<NodeDocument, 'label' | 'address' | 'publicKey' | 'tokenHash'>
  ): Promise<NodeDocument>
  revokeNode(label: string): Promise<boolean>
  deleteNode(label: string): Promise<boolean>
  touchNode(label: string, intervalMs: number): Promise<void>
  loadNodeKeys(): Promise<NodeKeys>
  loadRelayDevices(): Promise<RelayDevice[]>
  rejectDeviceRegistration(serial: string): Promise<r.WriteResult>
}

// isBoundTo <device> <node>: whether the binding of a device is valid with the node: active, same
// generation
export function isBoundTo(
  device: {node?: string | null, nodeGeneration?: number | null}
, node: NodeDocument | null
): node is NodeDocument {
  return Boolean(device.node && node && node.label === device.node && node.status === 'active' &&
    node.generation === device.nodeGeneration)
}

// The last <count> items of an array expression
function lastOf(array: r.Expression<unknown[]>, count: number) {
  return (array as unknown as {slice(start: number): r.Expression<unknown[]>}).slice(-count)
}

function toArray<T>(cursor: unknown): Promise<T[]> {
  return Promise.resolve((cursor as r.Cursor).toArray<T>())
}

export default function extendNodesDbApi(dbapi: DbApi, db: Db) {
  // A new invite of a label invalidates the outstanding ones of the label; the expired invites of a
  // day ago go too
  dbapi.createNodeInvite = function(invite) {
    return db.run(r.table('node_invites').getAll(invite.label, {index: 'label'})
      .filter({usedAt: null})
      .delete())
      .then(function() {
        return db.run(r.table('node_invites')
          .filter(r.row('expiresAt').lt(r.now().sub(24 * 60 * 60)))
          .delete())
      })
      .then(function() {
        return db.run(r.table('node_invites').insert(Object.assign({}, invite, {
          usedAt: null
        , createdAt: new Date()
        })))
      })
      .then(function() {})
  }

  dbapi.loadNodeInvite = function(hash) {
    return db.run(r.table('node_invites').get<NodeInviteDocument>(hash))
  }

  // Marks the invite used if it is unused, unexpired and of the label, in one atomic update of the
  // document: of two concurrent enrollments with the same invite one gets it, the other one null
  dbapi.consumeNodeInvite = function(hash, label) {
    var invites = r.table('node_invites')
    return db.run(invites.get<NodeInviteDocument>(hash).update(function(invite: InviteRow) {
      return r.branch(
        invite('usedAt').eq(null)
          .and(invite('expiresAt').gt(r.now()))
          .and(invite('label').eq(label))
      , {usedAt: r.now()}
      , {}
      )
    }, {returnChanges: true}))
      .then(function(stats) {
        var changes = (stats as WriteResultOf<NodeInviteDocument>).changes
        return stats.replaced === 1 && changes && changes[0] ? changes[0].new_val : null
      })
  }

  dbapi.loadNode = function(label) {
    return db.run(r.table('nodes').get<NodeDocument>(label))
  }

  dbapi.loadNodes = function() {
    return db.run(r.table('nodes').orderBy('label')).then(function(nodes) {
      return nodes as unknown as NodeDocument[]
    })
  }

  dbapi.loadNodeByAddress = function(address) {
    return db.run(r.table('nodes').getAll(address.toLowerCase(), {index: 'address'}))
      .then(function(cursor) {
        return toArray<NodeDocument>(cursor)
      })
      .then(function(nodes) {
        return nodes[0] || null
      })
  }

  // The node a key is or was the key of
  dbapi.loadNodeByPublicKey = function(publicKey) {
    var key = publicKey.toLowerCase()
    return db.run(r.table('nodes').filter(function(node) {
      return node('publicKey').eq(key).or(node('retiredKeys').default([]).contains(key))
    }))
      .then(function(cursor) {
        return toArray<NodeDocument>(cursor)
      })
      .then(function(nodes) {
        return nodes[0] || null
      })
  }

  // Creates the node, or replaces the key, the token and the address of an existing one
  // (re-enrollment, rotation): the old token and key stop working at once
  dbapi.enrollNode = function(fields) {
    var publicKey = fields.publicKey.toLowerCase()
    var address = fields.address.toLowerCase()
    return db.run(r.table('nodes').get<NodeDocument>(fields.label).replace(function(old: NodeRow) {
      return r.branch(
        old.eq(null)
      , {
          label: fields.label
        , address: address
        , publicKey: publicKey
        , tokenHash: fields.tokenHash
        , status: 'active'
        , createdAt: r.now()
        , revokedAt: null
        , lastSeenAt: null
        , generation: 1
        , retiredKeys: []
        }
      , old.merge({
          address: address
        , publicKey: publicKey
        , tokenHash: fields.tokenHash
        , status: 'active'
        , revokedAt: null
        , generation: old('generation').default(0).add(1)
        , retiredKeys: lastOf(old('retiredKeys').default([])
            .append(old('publicKey'))
            .filter(function(key: r.Expression<string>) {
              return key.ne(publicKey)
            }), RETIRED_KEYS)
        })
      )
    }, {returnChanges: 'always'} as unknown as r.UpdateOptions))
      .then(function(stats) {
        var changes = (stats as WriteResultOf<NodeDocument>).changes
        if (!changes || !changes[0] || !changes[0].new_val) {
          throw new Error(`Unable to enroll the node "${fields.label}"`)
        }
        return changes[0].new_val
      })
  }

  function deleteInvites(label: string) {
    return db.run(r.table('node_invites').getAll(label, {index: 'label'}).delete())
  }

  // Revokes a node: its token and key stop working, its outstanding invites and the binding of its
  // devices go
  dbapi.revokeNode = function(label) {
    return db.run(r.table('nodes').get<NodeDocument>(label).update(function(node) {
      return r.branch(node('status').eq('revoked'), {}, {status: 'revoked', revokedAt: r.now()})
    }))
      .then(function(stats) {
        if (stats.skipped) {
          return false
        }
        return deleteInvites(label)
          .then(function() {
            return db.run(r.table('devices').getAll(label, {index: 'node'}).update(UNBOUND))
          })
          .then(function() {
            return true
          })
      })
  }

  // Deletes a revoked node, atomically: an active one stays
  dbapi.deleteNode = function(label) {
    return db.run(r.table('nodes').get<NodeDocument>(label).replace(function(node: NodeRow) {
      return r.branch(node.eq(null).or(node('status').eq('revoked')), null, node)
    }))
      .then(function(stats) {
        if (!stats.deleted) {
          return false
        }
        return deleteInvites(label).then(function() {
          return true
        })
      })
  }

  // The last time the node was seen, written at most once per interval
  dbapi.touchNode = function(label, intervalMs) {
    return db.run(r.table('nodes').get<NodeDocument>(label).update(function(node) {
      return r.branch(
        node('lastSeenAt').default(null).eq(null)
          .or(node('lastSeenAt').lt(r.now().sub(intervalMs / 1000)))
      , {lastSeenAt: r.now()}
      , {}
      )
    }))
      .then(function() {})
  }

  // The keys of the active nodes, and the keys the triproxies refuse: of the revoked nodes and the
  // retired ones
  dbapi.loadNodeKeys = function() {
    return dbapi.loadNodes().then(function(nodes) {
      var allowed: string[] = []
      var denied: string[] = []
      nodes.forEach(function(node) {
        if (node.status === 'active') {
          allowed.push(node.publicKey)
        }
        else {
          denied.push(node.publicKey)
        }
        denied.push.apply(denied, node.retiredKeys || [])
      })
      return {allowed: allowed, denied: Array.from(new Set(denied))}
    })
  }

  // The present Android devices bound to an active node, with the address of the node (never the
  // display URL)
  dbapi.loadRelayDevices = function() {
    return Promise.all([
      dbapi.loadNodes()
    , db.run(r.table('devices')
        .filter(function(device) {
          return device('node').default(null).ne(null)
            .and(device('present').default(false).eq(true))
            .and(device('platform').default('').eq('Android'))
        })
        .pluck('serial', 'node', 'nodeGeneration', 'connectPort'))
        .then(function(cursor) {
          return toArray<BoundDevice>(cursor)
        })
    ])
      .then(function([nodes, devices]) {
        var byLabel = new Map(nodes.map(function(node) {
          return [node.label, node]
        }))
        return devices
          .filter(function(device) {
            return isBoundTo(device, byLabel.get(device.node) || null) &&
              Number.isInteger(device.connectPort) && device.connectPort! > 0
          })
          .map(function(device) {
            return {
              serial: device.serial
            , label: device.node
            , address: byLabel.get(device.node)!.address
            , connectPort: device.connectPort!
            }
          })
          .sort(function(a, b) {
            return a.serial.localeCompare(b.serial)
          })
      })
  }

  // A registration whose host is a registered node but that is not proved by it: no binding, no
  // ports
  dbapi.rejectDeviceRegistration = function(serial) {
    return db.run(r.table('devices').get(serial).update({
      node: null
    , nodeGeneration: null
    , screenPort: null
    , connectPort: null
    }))
  }
}
