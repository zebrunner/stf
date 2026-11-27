// Fork (Zebrunner): the cleanup of an iOS device between its uses, as the one of Android
// (lib/units/device/plugins/cleanup.ts): the apps of the user the device has when the unit starts first stay, the ones
// installed since (by the user of the device, a test) are uninstalled with go-ios when the device is released, but
// WebDriverAgent (the *.xctrunner of --cleanup-keep-packages, else any *.xctrunner) and the ones of --cleanup-keep-packages
// (lib/util/zebrunner-cleanup.ts). On with --cleanup (the default), --no-cleanup turns it off.
//
// The cleanup never stops the unit: when go-ios cannot list the apps at the start (a simulator, whose apps are of
// xcrun, or a device that is not reachable yet) it is off until the next start, and an app that cannot be
// uninstalled is logged and left.
//
// After the apps, the step 'profiles' of --cleanup-reset (lib/util/zebrunner-reset.ts) removes the configuration
// profiles installed since the first start (with the root certificates they installed and trusted), but the ones of
// the farm (FARM_PROFILES: the enrollment profile of the MDM, its ready profiles, the Wi-Fi of the farm) and of
// --cleanup-keep-profiles, the same way.
import syrup from '@devicefarmer/stf-syrup'
import Promise from 'bluebird'

import logger from '../../../util/logger.js'
import {
  keepMatcher
, keptBaseline
, keptWebDriverAgents
, stateBaselineFile
} from '../../../util/zebrunner-cleanup.js'
import {
  FARM_PROFILES
, IOS_RESET_STEPS
, parseProfiles
, resetSteps
} from '../../../util/zebrunner-reset.js'
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
  // the removal of the configuration profiles installed since the start, the identifiers it removed; as removeApps
  removeProfiles(since?: number): Promise<string[]>
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
    plugin.removeProfiles = function() {
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
    // WebDriverAgent of the device by its exact bundle id when the keep list has one, else any *.xctrunner: an app
    // of a user named *.xctrunner is no WebDriverAgent
    var exactWda = keptWebDriverAgents(options.cleanupKeepPackages).length > 0
    function farmApp(id: string) {
      return keep(id) || (!exactWda && id.endsWith('.xctrunner'))
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
      // the apps of the first start of the unit in this container, not of this start
      .then(function(apps) {
        return keptBaseline(options.serial, Array.from(apps))
      })
      .then(function(list) {
        var apps = new Set(list)
        log.info('Cleanup keeps the %d apps of the start: %j', apps.size, list)
        return apps
      })
      .catch(function(err: Error) {
        log.warn('Cleanup is off until the next start, the apps of the device are not listed: %s'
        , err.message)
        return null
      })

    // the configuration profiles of the start, as the apps; null: not removed
    var steps = resetSteps(options.cleanupReset, IOS_RESET_STEPS, log)
    var keepProfile = keepMatcher(FARM_PROFILES.concat(options.cleanupKeepProfiles || []))
    function listProfiles() {
      return execGoIos(options.serial, ['profile', 'list'], LIST_TIMEOUT)
        .then(function(result) {
          return parseProfiles(result.stdout)
        })
    }
    var initialProfiles: Promise<Set<string> | null> = !steps.has('profiles') ?
      Promise.resolve(null) :
      initialApps
        // after the apps: the device is reachable by then, or the cleanup is off anyway
        .then(function(apps) {
          if (!apps) {
            return null
          }
          return listProfiles()
            .then(function(profiles) {
              return keptBaseline(
                options.serial
              , profiles
              , stateBaselineFile(options.serial, 'profiles')
              , 'configuration profiles'
              )
            })
            .then(function(list) {
              log.info('Cleanup keeps the %d configuration profiles of the start: %j', list.length
              , list)
              return new Set(list)
            })
        })
        .catch(function(err: Error) {
          log.warn('Cleanup removes no configuration profile until the next start, they are not ' +
            'listed: %s', err.message)
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

    function removeProfile(id: string) {
      log.info('Cleaning up configuration profile "%s"', id)
      return execGoIos(options.serial, ['profile', 'remove', id], LIST_TIMEOUT)
        .then(function() {
          return id
        })
        .catch(function(err: Error) {
          log.warn('Unable to clean up configuration profile "%s": %s', id, err.message)
          return null
        })
    }

    plugin.removeProfiles = function(since = uses) {
      function usedAgain() {
        return uses !== since
      }
      return initialProfiles.then(function(initial) {
        if (!initial || usedAgain()) {
          return []
        }
        return listProfiles()
          .then(function(current) {
            var remove = current.filter(function(id) {
              return !initial.has(id) && !keepProfile(id)
            })
            return Promise.mapSeries(remove, function(id) {
              if (usedAgain()) {
                log.info('The device is used again: the cleanup leaves the profile "%s"', id)
                return null
              }
              return removeProfile(id)
            })
          })
          .then(function(removed) {
            return removed.filter(function(id): id is string {
              return id !== null
            })
          })
          .catch(function(err: Error) {
            log.warn('Unable to clean up the configuration profiles: %s', err.message)
            return []
          })
      })
    }

    // one cleanup at a time: a release during a running one waits for it; the profiles after the apps (one go-ios
    // call at a time)
    var running: Promise<unknown> = Promise.resolve()
    group.on('leave', function() {
      var since = uses
      var apps: string[] = []
      running = running
        .then(function() {
          return plugin.removeApps(since)
        })
        .then(function(removed) {
          apps = removed
          return plugin.removeProfiles(since)
        })
        .then(function(profiles) {
          log.info('Cleanup done, %d apps and %d configuration profiles removed', apps.length
          , profiles.length)
        })
    })

    return plugin
  })
