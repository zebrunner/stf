// Fork (Zebrunner): what the cleanup between the uses of a device keeps (lib/units/device/plugins/cleanup.ts of
// Android, lib/units/ios-device/plugins/cleanup.ts of iOS) besides the apps the device had when its unit started.
// The farm installs helpers after the start (the server of UiAutomator2 and the settings of Appium on the first
// session, the apps of the configuration of the MDM, WebDriverAgent again after a failure): without this list the
// cleanup would remove them after every use and the next one would install them again, or fight the MDM.

import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'

import Promise from 'bluebird'

import logger from './logger.js'

const log = logger.createLogger('util:zebrunner-cleanup')

// keepMatcher <patterns>: whether the cleanup keeps an app (an Android package, an iOS bundle id). A pattern is an
// exact id or a prefix that ends with '*' ('com.hmdm.*'); a value may hold several separated by commas or spaces,
// as an environment variable gives a list of the CLI (STF_PROVIDER_CLEANUP_KEEP_PACKAGES="a,b" is one value)
export function keepMatcher(patterns?: readonly unknown[]): (id: string) => boolean {
  var exact = new Set<string>()
  var prefixes: string[] = []
  ;(patterns || [])
    .flatMap(function(pattern) {
      return String(pattern).split(/[\s,]+/)
    })
    .filter(Boolean)
    .forEach(function(pattern) {
      if (pattern.endsWith('*')) {
        prefixes.push(pattern.slice(0, -1))
      }
      else {
        exact.add(pattern)
      }
    })
  return function(id: string) {
    return exact.has(id) || prefixes.some(function(prefix) {
      return id.startsWith(prefix)
    })
  }
}

// keptWebDriverAgents <patterns>: the exact bundle ids of WebDriverAgent (*.xctrunner) of the keep list, the
// WDA_BUNDLEID of the device (mcloud-device); none: an older deployment, which keeps any *.xctrunner
export function keptWebDriverAgents(patterns?: readonly unknown[]): string[] {
  return (patterns || [])
    .flatMap(function(pattern) {
      return String(pattern).split(/[\s,]+/)
    })
    .filter(function(pattern) {
      return pattern.endsWith('.xctrunner') && !pattern.includes('*')
    })
}

// STF_CLEANUP_BASELINE_DIR: the folder of the files of the apps a device had at the first start of its unit, the temp
// folder of the container by default (lib/units/device/plugins/cleanup.ts, lib/units/ios-device/plugins/cleanup.ts)
export const BASELINE_DIR = 'STF_CLEANUP_BASELINE_DIR'

export function baselineFile(
  serial: string
, dir: string = process.env[BASELINE_DIR] || os.tmpdir()
): string {
  return path.join(dir, `stf-cleanup-baseline-${encodeURIComponent(serial)}.json`)
}

function readBaseline(file: string): Promise<string[] | null> {
  return Promise.resolve(fs.readFile(file, 'utf8'))
    .then(function(text) {
      var apps = JSON.parse(text) as unknown
      return Array.isArray(apps) && apps.every(function(app) {
        return typeof app === 'string'
      }) ? apps as string[] : null
    })
    .catch(function() {
      return null
    })
}

// keptBaseline <serial> <apps> [file]: the apps the cleanup keeps, the ones of the first start of the unit in this
// container. A later start (the unit starts again after a reboot of the device, a crash) takes them from the file,
// not the apps of that moment: an app a user installed and kept over a reboot of the device does not become one of
// the device. The container made again starts a new list
export function keptBaseline(
  serial: string
, apps: readonly string[]
, file: string = baselineFile(serial)
): Promise<string[]> {
  return readBaseline(file).then(function(stored) {
    if (stored) {
      log.info('Cleanup keeps the %d apps of the first start of the unit (%s)', stored.length, file)
      return stored
    }
    var temp = `${file}.${process.pid}.tmp`
    return Promise.resolve(fs.writeFile(temp, JSON.stringify(apps), {mode: 0o600}))
      .then(function() {
        return fs.rename(temp, file)
      })
      .catch(function(err: Error) {
        log.warn(
          'Unable to keep the apps of the start in %s, a restart of the unit takes them again: %s'
        , file
        , err.message
        )
      })
      .then(function() {
        return apps.slice()
      })
  })
}
