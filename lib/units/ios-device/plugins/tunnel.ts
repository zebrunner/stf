import readline from 'readline'
import type {ChildProcessWithoutNullStreams} from 'child_process'

import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import lifecycle from '../../../util/lifecycle.js'
import type {IosDeviceOptions, IosTunnelPlugin} from '../../../types/ios-device.js'
import {execGoIos, goIosError, isAgentWarning, spawnGoIos, tunnelSupported} from './util/goios.js'

// The pauses before the tunnel is started again after it ended, the last one repeats
export var RESTART_DELAYS = [1000, 5000, 15000, 60000]

// The go-ios tunnel of iOS 17.4+ of the unit, in its own container: the services of the developer
// tools (process list, CPU load, display modes, network and thermal conditions, screenshots, the
// file service of iOS 17+) need it. It runs in user space through the lockdown service
// CoreDeviceProxy over the usbmuxd of the connector, so it needs no TUN device, no capability and no
// network shared with the connector, whose kernel tunnel (for WDA) keeps running next to it. Its API
// is on 127.0.0.1:60105 of the container, where the go-ios commands of the unit look for it
export default syrup.serial()
  .define(function(options: IosDeviceOptions): IosTunnelPlugin {
    var log = logger.createLogger('device:plugins:tunnel')
    var child: ChildProcessWithoutNullStreams | null = null
    var stopped = false
    var restarts = 0
    var timer: NodeJS.Timeout | null = null
    var plugin = Object.create(null) as IosTunnelPlugin

    function start() {
      if (stopped) {
        return
      }
      log.info('Starting the go-ios tunnel')
      var started = Date.now()
      var tunnel = spawnGoIos(options.serial, ['tunnel', 'start', '--userspace'])
      child = tunnel
      tunnel.stdout.resume()
      readline.createInterface({input: tunnel.stderr}).on('line', function(line) {
        if (isAgentWarning(line)) {
          return
        }
        var error = goIosError(line)
        if (error) {
          log.warn('go-ios tunnel: %s', error)
        }
        else if (line.includes('userspace tunnel negotiated')) {
          log.info('The go-ios tunnel is up')
          restarts = 0
        }
      })
      tunnel.on('error', function(err) {
        log.error('Unable to start the go-ios tunnel', err.message)
      })
      tunnel.on('close', function(code, signal) {
        if (child === tunnel) {
          child = null
        }
        if (stopped) {
          return
        }
        // a tunnel that ran for a while starts again quickly
        if (Date.now() - started > 60000) {
          restarts = 0
        }
        var delay = RESTART_DELAYS[Math.min(restarts++, RESTART_DELAYS.length - 1)]!
        log.warn('The go-ios tunnel ended (code %s, signal %s), again in %dms', code, signal, delay)
        timer = setTimeout(start, delay)
      })
    }

    plugin.isRunning = function() {
      return child !== null
    }

    plugin.stop = function() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (child) {
        child.kill()
        child = null
      }
    }

    lifecycle.observe(plugin.stop)

    // Not awaited: the unit does not wait for the tunnel, the features that need it fail until it is up
    execGoIos(options.serial, ['info'], 30000)
      .then(function(result) {
        if (tunnelSupported(result.stdout)) {
          start()
        }
        else {
          log.info('No go-ios tunnel: the device runs iOS before 17.4 or is not an iOS device')
        }
      })
      .catch(function(err) {
        log.info('No go-ios tunnel: lockdown cannot be reached (%s)', err.message)
      })

    return plugin
  })
