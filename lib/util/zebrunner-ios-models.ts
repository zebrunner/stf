// Fork (Zebrunner): the hardware of iOS and iPadOS models by the ProductType a device tells through
// lockdown (e.g. iPhone11,8), for the Info tab: @devicefarmer/stf-device-db knows a few old iPhones
// only. The table is zebrunner-ios-models.json; Apple does not publish RAM and clock speeds, they
// come from Wikipedia and appledb.dev
import {createRequire} from 'module'

var require = createRequire(import.meta.url)

export interface IosModel {
  name: string
  // YYYY-MM-DD
  released: string | null
  display: {
    inches: number | null
    ppi: number | null
    // the highest refresh rate, Hz
    fps: number | null
    width: number | null
    height: number | null
  }
  cpu: {
    name: string | null
    cores: number | null
    // GHz
    freq: number | null
  }
  // MB, the smallest of the model
  ram: number | null
}

interface IosDeviceView {
  ios?: boolean
  product?: string | null
  name?: string
  releasedAt?: string
  cpu?: {name?: string, cores?: number, freq?: number}
  memory?: {ram?: number, rom?: number}
  display?: {
    inches?: number
    fps?: number
    xdpi?: number
    ydpi?: number
    density?: number
    scale?: number
  }
}

var models: Record<string, IosModel> | null = null

function table(): Record<string, IosModel> {
  if (!models) {
    models = require('./zebrunner-ios-models.json') as Record<string, IosModel>
  }
  return models
}

// iosModel <productType>: the model of an iOS device, null when the table does not know it
export function iosModel(productType: string | null | undefined): IosModel | null {
  if (!productType) {
    return null
  }
  return Object.prototype.hasOwnProperty.call(table(), productType) ?
    table()[productType]! :
    null
}

function known<T>(value: T | null | undefined): value is T {
  return value !== null && typeof value !== 'undefined'
}

// applyIosModel <device>: the hardware of the model of an iOS device on top of what the device
// tells; what the device measures (its capacity, the scale of its screen) is kept
export function applyIosModel<D extends IosDeviceView>(device: D): D {
  var model = device.ios ? iosModel(device.product) : null
  if (!model) {
    return device
  }

  device.name = model.name
  if (model.released) {
    device.releasedAt = new Date(model.released + 'T00:00:00Z').toISOString()
  }

  var cpu: NonNullable<IosDeviceView['cpu']> = {}
  if (known(model.cpu.name)) {
    cpu.name = model.cpu.name
  }
  if (known(model.cpu.cores)) {
    cpu.cores = model.cpu.cores
  }
  if (known(model.cpu.freq)) {
    cpu.freq = model.cpu.freq
  }
  device.cpu = cpu

  device.memory = Object.assign({}, device.memory)
  if (known(model.ram)) {
    device.memory.ram = model.ram
  }

  var display = Object.assign({}, device.display)
  if (known(model.display.inches)) {
    display.inches = model.display.inches
  }
  if (known(model.display.fps)) {
    display.fps = model.display.fps
  }
  if (known(model.display.ppi)) {
    display.xdpi = model.display.ppi
    display.ydpi = model.display.ppi
  }
  if (known(display.scale)) {
    display.density = display.scale
  }
  device.display = display

  return device
}
