import readline from 'readline'
import type {ChildProcessWithoutNullStreams} from 'child_process'

import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import lifecycle from '../../../util/lifecycle.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {LogcatFilterFields} from '../../../types/wire.js'
import type {
  IosDeviceOptions
, IosGroupPlugin
, IosLogcatPlugin
, Push
, Router
} from '../../../types/ios-device.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import groupSyrup from './group.js'
import {goIosError, matchesFilters, parseSyslog, spawnGoIos} from './util/goios.js'

// The device log of the Logs tab: the syslog of the device read by `ios syslog`, sent as the
// entries of logcat (the process is the tag)
export default syrup.serial()
  .dependency(pushSyrup)
  .dependency(routerSyrup)
  .dependency(groupSyrup)
  .define(function(
    options: IosDeviceOptions
  , push: Push
  , router: Router
  , group: IosGroupPlugin
  ) {
    var log = logger.createLogger('device:plugins:devicelog')
    var plugin = Object.create(null) as IosLogcatPlugin
    var syslog: ChildProcessWithoutNullStreams | null = null
    var filters: LogcatFilterFields[] = []

    plugin.start = function(newFilters) {
      return group.get()
        .then(function(currentGroup) {
          return plugin.stop()
            .then(function() {
              log.info('Starting syslog')
              filters = newFilters
              return new Promise<void>(function(resolve, reject) {
                var child = spawnGoIos(options.serial, ['syslog'])
                var stderr = ''
                syslog = child

                readline.createInterface({input: child.stdout}).on('line', function(line) {
                  var entry = parseSyslog(line)
                  if (!entry || !matchesFilters(entry, filters)) {
                    return
                  }
                  push.send([
                    currentGroup.group
                  , wireutil.envelope(new wire.DeviceLogcatEntryMessage(
                      options.serial
                    , Date.now() / 1000
                    , entry.pid
                    , entry.pid
                    , entry.priority
                    , entry.tag
                    , entry.message
                    ))
                  ])
                })
                child.stderr.on('data', function(chunk: Buffer) {
                  stderr = (stderr + chunk.toString()).slice(-4096)
                })
                child.on('spawn', function() {
                  resolve()
                })
                child.on('error', function(err) {
                  if (syslog === child) {
                    syslog = null
                  }
                  reject(err)
                })
                child.on('exit', function(code, signal) {
                  if (syslog === child) {
                    syslog = null
                    log.warn(
                      'syslog ended (code %s, signal %s): %s'
                    , code
                    , signal
                    , goIosError(stderr) || stderr.trim()
                    )
                  }
                })
              })
            })
        })
    }

    plugin.stop = Promise.method(function() {
      if (syslog) {
        log.info('Stopping syslog')
        syslog.kill()
        syslog = null
      }
    })

    plugin.reset = Promise.method(function(newFilters: LogcatFilterFields[]) {
      if (!plugin.isRunning()) {
        throw new Error('syslog is not running')
      }
      filters = newFilters
    })

    plugin.isRunning = function() {
      return syslog !== null
    }

    lifecycle.observe(plugin.stop)
    group.on('leave', function() {
      plugin.stop()
    })

    router
      .on(wire.LogcatStartMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        plugin.start(message.filters)
          .then(function() {
            push.send([channel, reply.okay('success')])
          })
          .catch(function(err) {
            log.error('Unable to start syslog', err.stack)
            push.send([channel, reply.fail('fail')])
          })
      })
      .on(wire.LogcatApplyFiltersMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        plugin.reset(message.filters)
          .then(function() {
            push.send([channel, reply.okay('success')])
          })
          .catch(function(err) {
            log.error('Failed to apply the syslog filters', err.stack)
            push.send([channel, reply.fail('fail')])
          })
      })
      .on(wire.LogcatStopMessage, function(channel) {
        var reply = wireutil.reply(options.serial)
        plugin.stop()
          .then(function() {
            push.send([channel, reply.okay('success')])
          })
          .catch(function(err) {
            log.error('Failed to stop syslog', err.stack)
            push.send([channel, reply.fail('fail')])
          })
      })

    return plugin
  })
