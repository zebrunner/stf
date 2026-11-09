/**
* Fork (Zebrunner): the fixed connect port of a provider (--connect-port, STF_PROVIDER_CONNECT_PORT),
* the remote debug port (`adb connect`) of its device. mcloud runs one device per provider and
* publishes this port, so it is not left to the pool of --min-port..--max-port:
* - the port is taken out of the pool, the screen and the other ports of the workers never get it;
* - one device worker holds it at a time: the first one started while it is free. Another device
*   started meanwhile gets the connect port of its pool group (a warning), the port is free again
*   when its holder exits.
* Without the option the workers get all their ports from the pool, as in upstream.
**/

import logger from './logger.js'

const log = logger.createLogger('provider:connect-port')

// A worker takes its ports from the pool of the provider unit in groups of 4
// (lib/units/provider/index.ts): the screen port, the connect port and 2 unused ones
const GROUP = 4

export interface WorkerPorts {
  // the ports of the worker: the screen port, the connect port, the rest of its group
  ports: number[]
  // frees the fixed connect port when the worker held it, more calls do nothing
  release(): void
}

export interface ConnectPorts {
  // the pool of the provider unit: the ports of the range without the fixed connect port
  pool: number[]
  worker(serial: string, ports: number[]): WorkerPorts
}

export function range(from: number, to: number) {
  var items: number[] = []
  for (var i = from; i <= to; ++i) {
    items.push(i)
  }
  return items
}

export function connectPorts(ports: number[], connectPort?: number): ConnectPorts {
  if (!connectPort) {
    return {
      pool: ports
    , worker: function(serial, workerPorts) {
        return {ports: workerPorts, release: function() {}}
      }
    }
  }

  var holder: string | null = null
  return {
    pool: ports.filter(function(port) {
      return port !== connectPort
    })
  , worker: function(serial, workerPorts) {
      var result = workerPorts.slice()
      if (holder !== null) {
        log.warn(
          'The connect port %d is held by the device "%s", the device "%s" gets %d of the pool'
        , connectPort
        , holder
        , serial
        , result[1]
        )
        return {ports: result, release: function() {}}
      }
      holder = serial
      result[1] = connectPort
      var released = false
      return {
        ports: result
      , release: function() {
          if (!released) {
            released = true
            holder = null
          }
        }
      }
    }
  }
}

// checkConnectPort <minPort> <maxPort> <connectPort>: an error for an invalid fixed connect port
// or a pool without the ports of a worker, for the check of the provider options
export function checkConnectPort(minPort: number, maxPort: number, connectPort?: number) {
  if (typeof connectPort === 'undefined') {
    return true
  }
  if (!Number.isInteger(connectPort) || connectPort < 1 || connectPort > 65535) {
    throw new Error(`Invalid --connect-port "${connectPort}", expected a port of 1..65535`)
  }
  var pool = connectPorts(range(minPort, maxPort), connectPort).pool
  if (pool.length < GROUP) {
    throw new Error(`--min-port ${minPort}..--max-port ${maxPort} needs ${GROUP} ports ` +
      `besides --connect-port ${connectPort}`)
  }
  return true
}

export default {checkConnectPort, connectPorts, range}
