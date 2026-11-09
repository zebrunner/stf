/**
* Fork (Zebrunner): the node binding of the devices (ZEBRUNNER.md#nodes-enrollment). A device unit
* of an enrolled node proves its registration (DevicePortsMessage of Android,
* InitializeIosDeviceState of iOS) with the token of the node: the processor binds the device to the
* node when the proof is valid with the token of the active node and the host of the provider is the
* address of the node. A registration from the address of a registered node that is not proved by it
* is rejected: the device gets no ports and no binding and is not made ready. The other devices are
* unbound (legacy device hosts).
**/

import Promise from 'bluebird'

import zebrunnerNodes from '../../util/zebrunner-nodes.js'
import {UNBOUND, type NodeBinding, type NodeDocument} from '../../db/zebrunner-nodes.js'

export interface Registration {
  serial: string
  screenPort: number
  connectPort: number
  node?: string | null
  nodeProof?: string | null
  providerHost?: string | null
}

export type Decision =
  {result: 'bound', binding: NodeBinding} |
  {result: 'unbound', binding: NodeBinding, reason: string} |
  {result: 'rejected', reason: string}

export interface NodeBinderDb {
  loadNode(label: string): PromiseLike<NodeDocument | null>
  loadNodeByAddress(address: string): PromiseLike<NodeDocument | null>
}

interface Log {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

// decide <registration> <node of its label> <node of its host>: the binding of the device
export function decide(
  registration: Registration
, node: NodeDocument | null
, hostNode: NodeDocument | null
): Decision {
  var providerHost = registration.providerHost || ''
  var reason: string
  if (!registration.node) {
    reason = 'no node proof'
  }
  else if (!node || node.label !== registration.node) {
    reason = 'unknown node'
  }
  else if (node.status !== 'active') {
    reason = 'revoked node'
  }
  else if (!zebrunnerNodes.sameAddress(providerHost, node.address)) {
    reason = 'the host of the provider is not the address of the node'
  }
  else if (!zebrunnerNodes.verifyNodeProof(node.tokenHash, registration.nodeProof, {
    serial: registration.serial
  , providerHost: providerHost
  , screenPort: registration.screenPort
  , connectPort: registration.connectPort
  })) {
    reason = 'invalid node proof'
  }
  else {
    return {result: 'bound', binding: {node: node.label, nodeGeneration: node.generation}}
  }
  if (hostNode) {
    return {result: 'rejected', reason: reason}
  }
  return {result: 'unbound', binding: UNBOUND, reason: reason}
}

type Handler<M extends {serial: string}> =
  (channel: string | Buffer, message: M, data: Buffer) => void

export function createNodeBinder(db: NodeBinderDb, log: Log) {
  var pending = new Map<string, Promise<Decision>>()
  var rejected = new Set<string>()

  // bind <registration>: the decision for the registration of a device, never fails (unbound on an
  // error)
  function bind(registration: Registration): Promise<Decision> {
    var serial = registration.serial
    var decision = Promise.all([
      registration.node ? db.loadNode(registration.node) : null
    , registration.providerHost ? db.loadNodeByAddress(registration.providerHost) : null
    ])
      .then(function([node, hostNode]) {
        return decide(registration, node, hostNode)
      })
      .catch(function(err: Error): Decision {
        log.error('Unable to check the node of device "%s"', serial, err.stack)
        return {result: 'unbound', binding: UNBOUND, reason: 'error'}
      })
      .then(function(result) {
        if (result.result === 'rejected') {
          rejected.add(serial)
          log.warn(
            'Rejected the registration of device "%s" from "%s", the address of an enrolled ' +
            'node: %s'
          , serial
          , registration.providerHost
          , result.reason
          )
        }
        else {
          rejected.delete(serial)
          if (result.result === 'unbound' && registration.node) {
            log.warn(
              'Device "%s" from "%s" is not bound to node "%s": %s'
            , serial
            , registration.providerHost
            , registration.node
            , result.reason
            )
          }
        }
        if (pending.get(serial) === decision) {
          pending.delete(serial)
        }
        return result
      })
    pending.set(serial, decision)
    return decision
  }

  // accepted <serial>: false when the last registration of the device was rejected, after its check
  function accepted(serial: string): Promise<boolean> {
    return Promise.resolve(pending.get(serial)).then(function() {
      return !rejected.has(serial)
    })
  }

  // whenAccepted <handler>: the handler of a message of a device, not called for a device whose
  // registration was rejected
  function whenAccepted<M extends {serial: string}>(handler: Handler<M>): Handler<M> {
    return function(channel, message, data) {
      accepted(message.serial).then(function(ok) {
        if (ok) {
          handler(channel, message, data)
          return
        }
        log.warn('Device "%s" is not made ready: its registration was rejected', message.serial)
      })
    }
  }

  return {accepted, bind, whenAccepted}
}

export default {createNodeBinder, decide}
