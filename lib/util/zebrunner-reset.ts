// Fork (Zebrunner): the reset of the state of a device when it is released, after the uninstall of the apps of the
// cleanup (lib/units/device/plugins/cleanup.ts of Android, lib/units/ios-device/plugins/cleanup.ts of iOS): what a user
// (or an app, or `mobile: shell` of Appium) can leave on a device to reach the next user, while the farm's own setup
// stays (the device owner of the MDM, the helpers of --cleanup-keep-packages, the Wi-Fi networks of the first start,
// the adb keys, the profiles of the farm).
//
// --cleanup-reset lists the steps, every one of them can be left out; 'none' turns them all off. A step is logged and
// never stops the unit: a failure is logged and the next step runs.
//
// Android (adb shell, no root):
// - proxy: the global HTTP proxy (`settings put global http_proxy :0`, which Android applies at once, then the
//   http_proxy and global_http_proxy_* / global_proxy_pac_url keys deleted);
// - dns: the Private DNS of a host name (private_dns_mode=hostname) back to the default of Android;
// - accessibility: the accessibility services of the apps not of --cleanup-keep-packages turned off;
// - clipboard: the clipboard emptied (STFService);
// - wifi: the saved Wi-Fi networks that are neither of the first start of the unit nor of --cleanup-keep-wifi
//   forgotten (`cmd wifi`, Android 11+);
// - downloads: /sdcard/Download emptied; media (not by default): DCIM, Pictures, Movies, Music and Documents too;
// - report: the device admins and the accounts added since the first start logged as warnings: adb cannot remove them
//   (the user CA certificates neither: adb cannot even list them; the device owner could, see ZEBRUNNER.md).
// iOS (go-ios, lockdown):
// - profiles: the configuration profiles that are neither of the first start nor of the farm (FARM_PROFILES and
//   --cleanup-keep-profiles) removed, with the root certificates they installed and trusted.
import Promise from 'bluebird'

export var ANDROID_RESET_STEPS = [
  'proxy'
, 'dns'
, 'accessibility'
, 'clipboard'
, 'wifi'
, 'downloads'
, 'media'
, 'report'
]
export var IOS_RESET_STEPS = ['profiles']
// the default of --cleanup-reset, of both platforms: every step but media
export var DEFAULT_RESET_STEPS = ANDROID_RESET_STEPS
  .filter(function(step) {
    return step !== 'media'
  })
  .concat(IOS_RESET_STEPS)

// the profiles of the farm on an iOS device, by their exact identifiers (a prefix would keep a profile a user names
// after it): the enrollment profile of mcloud-mdm (MDM_PROFILE_ID by default), its ready profiles, the Wi-Fi profile of
// `zebrunner.sh mdm supervise` of mcloud-agent and the USB restricted mode profile of `ios prepare`
export var FARM_PROFILES = [
  'com.zebrunner.mcloud.mdm'
, 'com.zebrunner.mcloud.mdm.preset.swupdate-delay'
, 'com.zebrunner.mcloud.mdm.preset.bluetooth-off'
, 'com.zebrunner.mcloud.mdm.preset.airdrop-off'
, 'com.zebrunner.mcloud.mdm.preset.erase-off'
, 'com.zebrunner.mcloud.mdm.preset.wifi-allowed-only'
, 'com.zebrunner.mcloud.wifi'
, 'com.apple.configurator.usbrestrictedmode'
]

export var DOWNLOAD_FOLDERS = ['/sdcard/Download']
export var MEDIA_FOLDERS = [
  '/sdcard/DCIM'
, '/sdcard/Pictures'
, '/sdcard/Movies'
, '/sdcard/Music'
, '/sdcard/Documents'
]

// the keys of the global proxy: http_proxy (what `settings put` and the Wi-Fi settings of a user set) and the ones
// Android writes from it or a device owner sets
export var PROXY_KEYS = [
  'http_proxy'
, 'global_http_proxy_host'
, 'global_http_proxy_port'
, 'global_http_proxy_exclusion_list'
, 'global_proxy_pac_url'
]
export var DNS_KEYS = ['private_dns_mode', 'private_dns_specifier']
var ACCESSIBILITY_KEY = 'enabled_accessibility_services'

interface Log {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
}

// splitList <values> [separator]: the items of a list option, a value of the environment holds several (one value of
// yargs) separated by commas or spaces
export function splitList(
  values?: readonly unknown[]
, separator: RegExp = /[\s,]+/
): string[] {
  return (values || [])
    .flatMap(function(value) {
      return String(value).split(separator)
    })
    .map(function(item) {
      return item.trim()
    })
    .filter(Boolean)
}

// resetSteps <values> <platform steps>: the steps of --cleanup-reset the platform has; 'none' alone turns them off.
// The other names are ignored: the steps of the other platform (one list for both in mcloud-device) and unknown
// ones, which <log> warns about
export function resetSteps(
  values: readonly unknown[] | undefined
, platform: readonly string[]
, log?: Log
): Set<string> {
  var names = splitList(values)
  var known = new Set(ANDROID_RESET_STEPS.concat(IOS_RESET_STEPS))
  var unknown = names.filter(function(name) {
    return name !== 'none' && !known.has(name)
  })
  if (unknown.length && log) {
    log.warn('Unknown steps of --cleanup-reset are ignored: %j', unknown)
  }
  if (names.includes('none')) {
    return new Set()
  }
  return new Set(names.filter(function(name) {
    return platform.includes(name)
  }))
}

// parseSettings <stdout of settings list>: key=value per line
export function parseSettings(stdout: string): Map<string, string> {
  var settings = new Map<string, string>()
  stdout.split(/\r?\n/).forEach(function(line) {
    var at = line.indexOf('=')
    if (at > 0) {
      settings.set(line.slice(0, at), line.slice(at + 1).trim())
    }
  })
  return settings
}

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value !== '' && value !== 'null'
}

// the keys that make a proxy: Android writes the port 0 and empty other keys when it turns the proxy off
var PROXY_SET_KEYS = ['http_proxy', 'global_http_proxy_host', 'global_proxy_pac_url']

// proxyKeys <global settings>: the keys of a global proxy that is set (':0' is the "no proxy" of the reset)
export function proxyKeys(settings: Map<string, string>): string[] {
  return PROXY_SET_KEYS.filter(function(key) {
    var value = settings.get(key)
    return isSet(value) && !(key === 'http_proxy' && value === ':0')
  })
}

// packageOf <component>: the package of pkg/class
function packageOf(component: string): string {
  return component.split('/')[0] || ''
}

// splitAccessibility <value of enabled_accessibility_services> <keep>: the services that stay (of the apps <keep>
// keeps) and the others
export function splitAccessibility(
  value: string
, keep: (pkg: string) => boolean
): {kept: string[], removed: string[]} {
  var services = isSet(value.trim()) ? value.trim().split(':').filter(Boolean) : []
  return {
    kept: services.filter(function(service) {
      return keep(packageOf(service))
    })
  , removed: services.filter(function(service) {
      return !keep(packageOf(service))
    })
  }
}

export interface WifiNetwork {
  id: string
  ssid: string
  security: string
}

// parseWifiNetworks <stdout of cmd wifi list-networks>: the saved networks (Android 11+: "Network Id  SSID  Security
// type" then a line per network, the SSID padded to 32 characters); without the header the command is not there
export function parseWifiNetworks(stdout: string): WifiNetwork[] {
  var lines = stdout.split(/\r?\n/)
  if (!lines.some(function(line) {
    return /^Network Id\s+SSID\s+Security type/.test(line.trim())
  })) {
    if (/no networks/i.test(stdout)) {
      return []
    }
    throw new Error('cmd wifi list-networks printed no list of networks')
  }
  return lines
    .map(function(line) {
      return /^(\d+)\s+(.*\S)\s+(\S+)$/.exec(line.trim())
    })
    .filter(function(match): match is RegExpExecArray {
      return match !== null
    })
    .map(function(match) {
      return {id: match[1] || '', ssid: match[2] || '', security: match[3] || ''}
    })
}

// wifiKey <network>: a network of the first start is the same SSID with the same security (an open network of the
// name of the farm network is not it)
export function wifiKey(network: WifiNetwork): string {
  return `${network.ssid}\t${network.security}`
}

// parseDeviceAdmins <stdout of dumpsys device_policy>: the components of the enabled device admins
export function parseDeviceAdmins(stdout: string): string[] {
  var at = stdout.indexOf('Enabled Device Admins')
  if (at < 0) {
    return []
  }
  var admins = new Set<string>()
  var component = /^\s+([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+):\s*$/gm
  var section = stdout.slice(at)
  for (var match = component.exec(section); match; match = component.exec(section)) {
    admins.add(match[1] || '')
  }
  return Array.from(admins)
}

// parseAccountTypes <stdout of dumpsys account>: the types of the accounts, one per account, never their names
export function parseAccountTypes(stdout: string): string[] {
  var types: string[] = []
  var account = /Account \{name=.*?, type=([^}\s]+)\}/g
  for (var match = account.exec(stdout); match; match = account.exec(stdout)) {
    types.push(match[1] || '')
  }
  return types.sort()
}

// added <current> <baseline>: the items of <current> beyond the ones of <baseline>, counted (a second account of a
// type is added)
export function added(current: readonly string[], baseline: readonly string[]): string[] {
  var left = new Map<string, number>()
  baseline.forEach(function(item) {
    left.set(item, (left.get(item) || 0) + 1)
  })
  return current.filter(function(item) {
    var count = left.get(item) || 0
    if (count > 0) {
      left.set(item, count - 1)
      return false
    }
    return true
  })
}

// parseProfiles <stdout of go-ios profile list>: the identifiers of the installed configuration profiles
export function parseProfiles(stdout: string): string[] {
  var text = stdout.trim()
  // go-ios prints null for no profiles (a nil list of Go)
  var json = text.startsWith('[') ? text : stdout.split('\n').find(function(line) {
    return line.trim().startsWith('[') || line.trim() === 'null'
  })
  if (!json) {
    throw new Error('go-ios profile list printed no list of profiles')
  }
  var profiles = JSON.parse(json) as Array<{Identifier?: unknown}> | null
  if (profiles === null) {
    return []
  }
  if (!Array.isArray(profiles)) {
    throw new Error('go-ios profile list printed no list of profiles')
  }
  return profiles
    .map(function(profile) {
      return profile && profile.Identifier
    })
    .filter(function(id): id is string {
      return typeof id === 'string' && id !== ''
    })
}

// the shell of an Android device: the arguments are quoted by adbkit, the output is the text
export type Shell = (args: string[]) => PromiseLike<string>

// the lists of the first start the Android reset compares with, null: not known (the step is off)
export interface AndroidBaseline {
  wifi: string[] | null
  admins: string[] | null
  accounts: string[] | null
}

export interface AndroidResetOptions {
  shell: Shell
  steps: Set<string>
  log: Log
  // the apps of the farm (--cleanup-keep-packages): their accessibility services stay
  keep(pkg: string): boolean
  // the SSIDs of --cleanup-keep-wifi
  keepWifi: readonly string[]
  baseline: AndroidBaseline
  setClipboard(text: string): PromiseLike<unknown>
}

// androidBaselineNow <shell> <steps>: the lists of this moment the steps need, null for the ones that fail
export function androidBaselineNow(
  shell: Shell
, steps: Set<string>
, log: Log
): Promise<AndroidBaseline> {
  function read<T>(enabled: boolean, what: string, take: () => PromiseLike<T>): Promise<T | null> {
    if (!enabled) {
      return Promise.resolve(null)
    }
    return Promise.resolve(take())
      .catch(function(err: Error) {
        log.warn('Cleanup does not reset the %s until the next start, they are not listed: %s'
        , what
        , err.message)
        return null
      })
  }
  return Promise.props({
    wifi: read(steps.has('wifi'), 'Wi-Fi networks', function() {
      return Promise.resolve(shell(['cmd', 'wifi', 'list-networks'])).then(function(stdout) {
        return parseWifiNetworks(stdout).map(wifiKey)
      })
    })
  , admins: read(steps.has('report'), 'device admins', function() {
      return Promise.resolve(shell(['dumpsys', 'device_policy'])).then(parseDeviceAdmins)
    })
  , accounts: read(steps.has('report'), 'accounts', function() {
      return Promise.resolve(shell(['dumpsys', 'account'])).then(parseAccountTypes)
    })
  })
}

// androidReset <options>: runs the steps in their order, each one logged; never rejects
export function androidReset(options: AndroidResetOptions): Promise<string[]> {
  var shell = options.shell
  var log = options.log
  var global: Promise<Map<string, string>> | null = null

  function globalSettings() {
    if (!global) {
      global = Promise.resolve(shell(['settings', 'list', 'global'])).then(parseSettings)
    }
    return global
  }

  function run(args: string[]) {
    return Promise.resolve(shell(args))
  }

  // the entries of a folder, none when it is not there (find prints its error instead)
  function entries(folder: string) {
    return run(['find', folder, '-mindepth', '1', '-maxdepth', '1'])
      .then(function(stdout) {
        return stdout.split(/\r?\n/).filter(function(line) {
          return line.startsWith(folder + '/')
        })
      })
  }

  function emptyFolder(folder: string) {
    return entries(folder)
      .then(function(found) {
        if (!found.length) {
          return null
        }
        // the names are the user's, only their number is logged
        log.info('Cleanup removes the %d files and folders of %s', found.length, folder)
        var remove = ['-exec', 'rm', '-rf', '{}', '+']
        return run(['find', folder, '-mindepth', '1', '-maxdepth', '1'].concat(remove))
          .then(function() {
            return entries(folder)
          })
          .then(function(left) {
            if (left.length) {
              log.warn('Cleanup could not remove %d files and folders of %s', left.length, folder)
            }
            return null
          })
      })
  }

  var steps: Record<string, () => PromiseLike<unknown>> = {
    proxy: function() {
      return globalSettings().then(function(settings) {
        var keys = proxyKeys(settings)
        if (!keys.length) {
          return null
        }
        log.info('Cleanup resets the global proxy of the device (%s)', keys.join(', '))
        // ':0' is "no proxy", applied at once (a deleted key is applied at the next boot only)
        return run(['settings', 'put', 'global', 'http_proxy', ':0'])
          .then(function() {
            return Promise.mapSeries(PROXY_KEYS, function(key) {
              return run(['settings', 'delete', 'global', key])
            })
          })
      })
    }
  , dns: function() {
      return globalSettings().then(function(settings) {
        if (settings.get('private_dns_mode') !== 'hostname') {
          return null
        }
        log.info('Cleanup resets the Private DNS of the device to the default of Android')
        return Promise.mapSeries(DNS_KEYS, function(key) {
          return run(['settings', 'delete', 'global', key])
        })
      })
    }
  , accessibility: function() {
      return run(['settings', 'get', 'secure', ACCESSIBILITY_KEY])
        .then(function(value) {
          var services = splitAccessibility(value, options.keep)
          if (!services.removed.length) {
            return null
          }
          log.info('Cleanup turns off the accessibility services %j', services.removed)
          if (services.kept.length) {
            return run([
              'settings', 'put', 'secure', ACCESSIBILITY_KEY, services.kept.join(':')
            ])
          }
          return run(['settings', 'delete', 'secure', ACCESSIBILITY_KEY])
            .then(function() {
              return run(['settings', 'put', 'secure', 'accessibility_enabled', '0'])
            })
        })
    }
  , clipboard: function() {
      log.info('Cleanup empties the clipboard')
      return options.setClipboard('')
    }
  , wifi: function() {
      var baseline = options.baseline.wifi
      if (!baseline) {
        return Promise.resolve()
      }
      var kept = new Set(baseline)
      var keepSsids = new Set(options.keepWifi)
      return run(['cmd', 'wifi', 'list-networks'])
        .then(parseWifiNetworks)
        .then(function(networks) {
          var forget = networks.filter(function(network) {
            return !kept.has(wifiKey(network)) && !keepSsids.has(network.ssid)
          })
          return Promise.mapSeries(forget, function(network) {
            log.info('Cleanup forgets the Wi-Fi network "%s" (%s)', network.ssid, network.security)
            return run(['cmd', 'wifi', 'forget-network', network.id])
              .then(function(stdout) {
                if (!/success/i.test(stdout)) {
                  log.warn('Unable to forget the Wi-Fi network "%s": %s', network.ssid
                  , stdout.trim())
                }
              })
          })
        })
    }
  , downloads: function() {
      return Promise.mapSeries(DOWNLOAD_FOLDERS, emptyFolder)
    }
  , media: function() {
      return Promise.mapSeries(MEDIA_FOLDERS, emptyFolder)
    }
  , report: function() {
      var baseline = options.baseline
      return Promise.all([
        baseline.admins && run(['dumpsys', 'device_policy']).then(function(stdout) {
          var admins = added(parseDeviceAdmins(stdout), baseline.admins || [])
            .filter(function(admin) {
              return !options.keep(packageOf(admin))
            })
          if (admins.length) {
            log.warn('The device has device admins since the first start the cleanup cannot ' +
              'turn off (and their apps cannot be uninstalled): %j', admins)
          }
        })
      , baseline.accounts && run(['dumpsys', 'account']).then(function(stdout) {
          var accounts = added(parseAccountTypes(stdout), baseline.accounts || [])
          if (accounts.length) {
            log.warn('The device has %d accounts since the first start the cleanup cannot ' +
              'remove, of the types %j', accounts.length, accounts)
          }
        })
      ])
    }
  }

  var done: string[] = []
  return Promise.mapSeries(ANDROID_RESET_STEPS, function(name) {
    var step = steps[name]
    if (!step || !options.steps.has(name)) {
      return null
    }
    return Promise.resolve(step())
      .then(function() {
        done.push(name)
      })
      .catch(function(err: Error) {
        log.warn('Cleanup step "%s" failed: %s', name, err && err.message)
      })
  })
    .then(function() {
      return done
    })
}
