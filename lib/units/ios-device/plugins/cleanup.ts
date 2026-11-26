// Fork (Zebrunner): the cleanup of an iOS device between its uses, as the one of Android
// (lib/units/device/plugins/cleanup.ts): the apps of the user the device has when the unit starts stay, the ones
// installed since (by the user of the device, a test) are uninstalled with go-ios when the device is released, but
// WebDriverAgent (any *.xctrunner, the automation of the device) and the ones of --cleanup-keep-packages
// (lib/util/zebrunner-cleanup.ts). On with --cleanup (the default), --no-cleanup turns it off.
//
// The cleanup never stops the unit: when go-ios cannot list the apps at the start (a simulator, whose apps are of
// xcrun, or a device that is not reachable yet) it is off until the next start, and an app that cannot be
// uninstalled is logged and left.
import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import {keepMatcher} from '../../../util/zebrunner-cleanup.js'
import type {IosDeviceOptions, IosGroupPlugin} from '../../../types/ios-device.js'
import groupSyrup from './group.js'
import {execGoIos} from './util/goios.js'

// the list of the apps and an uninstall: installation_proxy of lockdown, no tunnel; a large app takes a while
const LIST_TIMEOUT = 60000
const UNINSTALL_TIMEOUT = 120000
// the attempts to list the apps at the start (the device may still be pairing) and the pause between them; the tests
// shorten the pause
export var startRetry = {attempts: 3, delay: 5000}

export interface IosCleanupPlugin {
  // the uninstall of the apps installed since the start, the bundle ids it removed; a cleanup of the release of
  // <since> (the uses of the device counted at that release) stops when the device is used again meanwhile
  removeApps(since?: number): Promise<string[]>
}

// parseApps <stdout of go-ios apps>: the bundle ids of the apps of the user, go-ios prints them as a JSON array
export function parseApps(stdout: string): string[] {
  var text = stdout.trim()
  var json = text.startsWith('[') ? text : stdout.split('\n').find(function(line) {
    return line.trim().startsWith('[')
  })
  if (!json) {
    throw new Error('go-ios apps printed no list of apps')
  }
  var apps = JSON.parse(json) as Array<{CFBundleIdentifier?: unknown}>
  if (!Array.isArray(apps)) {
    throw new Error('go-ios apps printed no list of apps')
  }
  return apps
    .map(function(app) {
      return app && app.CFBundleIdentifier
    })
    .filter(function(id): id is string {
      return typeof id === 'string' && id !== ''
    })
}

export default syrup.serial()
  .dependency(groupSyrup)
  .define(function(options: IosDeviceOptions, group: IosGroupPlugin) {
    var log = logger.createLogger('device:plugins:cleanup')
    var plugin = Object.create(null) as IosCleanupPlugin
    plugin.removeApps = function() {
      return Promise.resolve([])
    }
    if (!options.cleanup) {
      return plugin
    }

    var keep = keepMatcher(options.cleanupKeepPackages)
    // the uses of the device: a cleanup starts no other uninstall once the device is used again, so the next user
    // (e.g. a test of the same app that starts at once and keeps the app it finds) loses at most the one in progress
    var uses = 0
    group.on('join', function() {
      uses += 1
    })
    function farmApp(id: string) {
      return id.endsWith('.xctrunner') || keep(id)
    }

    function listApps() {
      return execGoIos(options.serial, ['apps'], LIST_TIMEOUT)
        .then(function(result) {
          return parseApps(result.stdout)
        })
    }

    function snapshot(attempt: number): Promise<Set<string>> {
      return listApps()
        .then(function(apps) {
          return new Set(apps)
        })
        .catch(function(err: Error) {
          if (attempt >= startRetry.attempts) {
            throw err
          }
          return Promise.delay(startRetry.delay).then(function() {
            return snapshot(attempt + 1)
          })
        })
    }

    // the apps of the start, taken in the background: the start of the unit does not wait for go-ios
    var initialApps = snapshot(1)
      .then(function(apps) {
        log.info('Cleanup keeps the %d apps of the start: %j', apps.size, Array.from(apps))
        return apps
      })
      .catch(function(err: Error) {
        log.warn('Cleanup is off until the next start, the apps of the device are not listed: %s'
        , err.message)
        return null
      })

    function uninstall(id: string) {
      log.info('Cleaning up app "%s"', id)
      return execGoIos(options.serial, ['uninstall', id], UNINSTALL_TIMEOUT)
        .then(function() {
          return id
        })
        .catch(function(err: Error) {
          log.warn('Unable to clean up app "%s": %s', id, err.message)
          return null
        })
    }

    plugin.removeApps = function(since = uses) {
      function usedAgain() {
        return uses !== since
      }
      return initialApps.then(function(initial) {
        if (!initial || usedAgain()) {
          return []
        }
        return listApps()
          .then(function(current) {
            var remove = current.filter(function(id) {
              return !initial.has(id) && !farmApp(id)
            })
            return Promise.mapSeries(remove, function(id) {
              if (usedAgain()) {
                log.info('The device is used again: the cleanup leaves "%s"', id)
                return null
              }
              return uninstall(id)
            })
          })
          .then(function(removed) {
            return removed.filter(function(id): id is string {
              return id !== null
            })
          })
          .catch(function(err: Error) {
            log.warn('Unable to clean up the apps: %s', err.message)
            return []
          })
      })
    }

    // one cleanup at a time: a release during a running one waits for it
    var running: Promise<unknown> = Promise.resolve()
    group.on('leave', function() {
      var since = uses
      running = running.then(function() {
        return plugin.removeApps(since)
      })
        .then(function(removed) {
          log.info('Cleanup done, %d apps removed', (removed as string[]).length)
        })
    })

    return plugin
  })
