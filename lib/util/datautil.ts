/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import deviceData from '@devicefarmer/stf-device-db'
import browserData from '@devicefarmer/stf-browser-db'

import deviceutil from './deviceutil.js'
// Fork (Zebrunner)
import {applyIosModel} from './zebrunner-ios-models.js'
import type {DeviceDisplayMessageFields} from '../types/wire.js'

interface DisplayView extends Partial<DeviceDisplayMessageFields> {
  inches?: number
}

interface BrowserView {
  apps: Array<{type: string, developer?: string}>
}

interface DeviceView extends deviceutil.Claimable {
  present?: boolean
  using?: boolean
  claimed?: boolean
  model?: string | null
  product?: string | null
  manufacturer?: string | null
  platform?: string | null
  name?: string
  releasedAt?: string
  image?: string
  // GHz
  cpu?: {name?: string, cores?: number, freq?: number}
  // MB
  memory?: {ram?: number, rom?: number}
  display?: DisplayView
  browser?: BrowserView | null
  remoteConnect?: boolean
  remoteConnectUrl?: string | null
}

interface DataUtil {
  applyData<D extends DeviceView>(device: D): D
  applyBrowsers<D extends DeviceView>(device: D): D
  applyOwner<D extends DeviceView>(device: D, user: deviceutil.Viewer): D
  applyOwnerOnlyInfo(device: DeviceView, user: deviceutil.Viewer): void
  normalize(device: DeviceView, user: deviceutil.Viewer): void
}

var datautil: DataUtil = Object.create(null)

function known<T>(value: T | null | undefined): value is T {
  return value !== null && typeof value !== 'undefined'
}

// The diagonal of the screen from its size in pixels and its density, as stf-device-db 2 has no
// display; a density far off (some emulators) gives no size rather than a wrong one
function displayInches(display: DisplayView): number | null {
  if (!(display.width! > 0 && display.height! > 0 && display.xdpi! > 0 && display.ydpi! > 0)) {
    return null
  }
  var inches = Math.hypot(display.width! / display.xdpi!, display.height! / display.ydpi!)
  return inches >= 1 && inches <= 30 ? Math.round(inches * 10) / 10 : null
}

datautil.applyData = function<D extends DeviceView>(device: D) {
  // Only knows Android devices, null for the others
  var match = deviceData.find({
    model: device.model
  , name: device.product
  , manufacturer: device.manufacturer
  , platform: device.platform
  })

  if (match) {
    if (!device.name) {
      device.name = match.name.id
    }
    if (match.date) {
      device.releasedAt = new Date(match.date + 'T00:00:00Z').toISOString()
    }
    device.image = match.image
    if (match.cpu) {
      var cpu: NonNullable<DeviceView['cpu']> = {}
      if (known(match.cpu.name)) {
        cpu.name = match.cpu.name
      }
      if (known(match.cpu.cores)) {
        cpu.cores = match.cpu.cores
      }
      if (known(match.cpu.freq)) {
        cpu.freq = match.cpu.freq
      }
      device.cpu = cpu
    }
    // Fork (Zebrunner): the memory an iOS device tells (its capacity through go-ios) wins over the
    // one of its model, which comes in several capacities
    if (match.memory) {
      var memory: NonNullable<DeviceView['memory']> = {}
      if (known(match.memory.ram)) {
        memory.ram = match.memory.ram
      }
      // GB in the db, MB for stf (and go-ios)
      if (known(match.memory.rom)) {
        memory.rom = Math.round(match.memory.rom * 1024)
      }
      device.memory = Object.assign(memory, device.memory)
    }
  }

  if (device.display && !device.display.inches) {
    var inches = displayInches(device.display)
    if (inches) {
      device.display.inches = inches
    }
  }

  // Fork (Zebrunner): the hardware of iOS models, which the device db above hardly knows
  return applyIosModel(device as D & {ios?: boolean})
}

datautil.applyBrowsers = function<D extends DeviceView>(device: D) {
  if (device.browser) {
    device.browser.apps.forEach(function(app) {
      var data = browserData[app.type]
      if (data) {
        app.developer = data.developer
      }
    })
  }
  return device
}

datautil.applyOwner = function<D extends DeviceView>(device: D, user: deviceutil.Viewer) {
  device.using = !!device.owner &&
                 (device.owner.email === user.email || user.privilege === 'admin')
  return device
}

// Only owner can see this information
datautil.applyOwnerOnlyInfo = function(device: DeviceView, user: deviceutil.Viewer) {
  if (device.owner && (device.owner.email === user.email || user.privilege === 'admin')) {
    // No-op
  }
  else {
    device.remoteConnect = false
    device.remoteConnectUrl = null
  }
}

datautil.normalize = function(device: DeviceView, user: deviceutil.Viewer) {
  datautil.applyData(device)
  datautil.applyBrowsers(device)
  datautil.applyOwner(device, user)
  datautil.applyOwnerOnlyInfo(device, user)
  // Fork (Zebrunner): an absent device keeps its owner for whom `using` is true (an admin, the
  // owner): a device whose host went away during a session stays controlled, and they must see by whom
  if (!device.present && !device.using) {
    device.owner = null
  }
  // Whether a device is being held is worth knowing; who it is being held for is not anyone
  // else's business, so the name does not leave the server. An expired claim holds nothing, so it
  // must not read as held here either: this is the only place the expiry is judged for readers.
  device.claimed = deviceutil.isClaimLive(device, Date.now())
  delete device.restoreOwner
}

namespace datautil {
  export type Device = DeviceView
}

export default datautil
