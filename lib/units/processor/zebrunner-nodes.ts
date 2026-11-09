/**
* Fork (Zebrunner): the node binding of the devices (ZEBRUNNER.md#nodes-enrollment). A device unit
* of an enrolled node proves its registration (DevicePortsMessage of Android,
* InitializeIosDeviceState of iOS) with the token of the node: the processor binds the device to the
* node when the node is active, the proof is valid with its token and the host of the provider is
* the address of the node. Any other registration is rejected: the device gets no ports and no
* binding and is not made ready.
**/

import Promise from 'bluebird'

import zebrunnerNodes from '../../util/zebrunner-nodes.js'
import {isBoundTo, type NodeBinding, type NodeDocument} from '../../db/zebrunner-nodes.js'

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
  {result: 'rejected', reason: string}

export interface NodeBinderDb {
  loadNode(label: string): PromiseLike<NodeDocument | null>
  loadDeviceBySerial(serial: string): PromiseLike<{
    node?: string | null
    nodeGeneration?: number | null
  } | null>
}

interface Log {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

// decide <registration> <node of its label>: the binding of the device, or why it is rejected
export function decide(registration: Registration, node: NodeDocument | null): Decision {
  var providerHost = registration.providerHost || ''
  var reason: string
  if (!registration.node) {
    reason = 'no node proof (STF_NODE_TOKEN of the device container)'
  }
  else if (!node || node.label !== registration.node) {
    reason = 'unknown node'
  }
  else if (node.status !== 'active') {
    reason = 'revoked node'
  }
  else if (!zebrunnerNodes.sameAddress(providerHost, node.address)) {
    reason = 'the host of the provider (STF_PROVIDER_HOST) is not the address of the node'
  }
  else if (!zebrunnerNodes.verifyNodeProof(node.tokenHash, registration.nodeProof, {
    serial: registration.serial
  , providerHost: providerHost
  , screenPort: registration.screenPort
  , connectPort: registration.connectPort
  })) {
    reason = 'invalid node proof (not the current token of the node)'
  }
  else {
    return {result: 'bound', binding: {node: node.label, nodeGeneration: node.generation}}
  }
  return {result: 'rejected', reason: reason}
}

// The node a registration claims, for the diagnostics of that node: a label, else null
export function claimOf(registration: {node?: string | null}): string | null {
  return zebrunnerNodes.isLabel(registration.node) ? registration.node : null
}

type Handler<M extends {serial: string}> =
  (channel: string | Buffer, message: M, data: Buffer) => void

export interface BinderOptions {
  // how long a ready device this processor did not register waits for its binding in the database
  // (another processor checks its registration), and how often it looks
  bindingWait?: number
  bindingPoll?: number
}

export function createNodeBinder(db: NodeBinderDb, log: Log, options: BinderOptions = {}) {
  var bindingWait = typeof options.bindingWait === 'number' ? options.bindingWait : 10000
  var bindingPoll = options.bindingPoll || 200
  var pending = new Map<string, Promise<Decision>>()
  // the last decision of every device registered with this processor
  var bound = new Map<string, boolean>()

  // bind <registration>: the decision for the registration of a device, never fails (rejected on
  // an error)
  function bind(registration: Registration): Promise<Decision> {
    var serial = registration.serial
    var decision = Promise.resolve(registration.node ? db.loadNode(registration.node) : null)
      .then(function(node) {
        return decide(registration, node)
      })
      .catch(function(err: Error): Decision {
        log.error('Unable to check the node of device "%s"', serial, err.stack)
        return {result: 'rejected', reason: 'the node could not be checked'}
      })
      .then(function(result) {
        bound.set(serial, result.result === 'bound')
        if (result.result === 'rejected') {
          log.warn(
            'Rejected the registration of device "%s" from "%s" (node "%s"): %s'
          , serial
          , registration.providerHost || ''
          , claimOf(registration) || ''
          , result.reason
          )
        }
        if (pending.get(serial) === decision) {
          pending.delete(serial)
        }
        return result
      })
    pending.set(serial, decision)
    return decision
  }

  function boundInDatabase(serial: string): Promise<boolean> {
    return Promise.resolve(db.loadDeviceBySerial(serial))
      .then(function(device) {
        if (!device || !device.node) {
          return false
        }
        return Promise.resolve(db.loadNode(device.node)).then(function(node) {
          return isBoundTo(device, node)
        })
      })
  }

  // waitForBinding <serial> <deadline>: whether the database has a valid binding of the device
  // before the deadline
  function waitForBinding(serial: string, deadline: number): Promise<boolean> {
    return boundInDatabase(serial).then(function(ok): Promise<boolean> | boolean {
      if (ok || Date.now() + bindingPoll > deadline) {
        return ok
      }
      return Promise.delay(bindingPoll).then(function() {
        return waitForBinding(serial, deadline)
      })
    })
  }

  // accepted <serial>: whether the device is bound to an active node, after the check of its last
  // registration. A device this processor did not register is checked in the database: another
  // processor got its registration (the dealer of the triproxy shares the messages between the
  // processors) and writes its binding a moment later, or this processor restarted
  function accepted(serial: string): Promise<boolean> {
    return Promise.resolve(pending.get(serial)).then(function() {
      if (bound.has(serial)) {
        return bound.get(serial)!
      }
      return waitForBinding(serial, Date.now() + bindingWait)
        .catch(function(err: Error) {
          log.error('Unable to check the node of device "%s"', serial, err.stack)
          return false
        })
    })
  }

  // whenAccepted <handler>: the handler of a message of a device, not called for a device that is
  // not bound to an active node
  function whenAccepted<M extends {serial: string}>(handler: Handler<M>): Handler<M> {
    return function(channel, message, data) {
      accepted(message.serial).then(function(ok) {
        if (ok) {
          handler(channel, message, data)
          return
        }
        log.warn('Device "%s" is not made ready: it is not bound to an active node', message.serial)
      })
    }
  }

  return {accepted, bind, whenAccepted}
}

export default {claimOf, createNodeBinder, decide}
