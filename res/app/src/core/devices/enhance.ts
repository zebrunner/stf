import {appState} from '../app-state'
import {gettext, translate} from '../i18n'
import type {Device, DeviceState} from './types'

const stateActions: Record<DeviceState, string> = {
  absent: gettext('Disconnected')
  , present: gettext('Connected')
  , offline: gettext('Offline')
  , unauthorized: gettext('Unauthorized')
  , preparing: gettext('Preparing')
  , ready: gettext('Ready')
  , using: gettext('Stop Using')
  , busy: gettext('Busy')
  , available: gettext('Use')
  , automation: gettext('Stop Automation')
  , unhealthy: gettext('Unhealthy')
}

const statePassives: Record<DeviceState, string> = {
  absent: gettext('Disconnected')
  , present: gettext('Connected')
  , offline: gettext('Offline')
  , unauthorized: gettext('Unauthorized')
  , preparing: gettext('Preparing')
  , ready: gettext('Ready')
  , using: gettext('Using')
  , busy: gettext('Busy')
  , available: gettext('Available')
  , automation: gettext('Automating')
  , unhealthy: gettext('Unhealthy')
}

export const likelyLeaveReasons: Record<string, string> = {
  ungroup_request: gettext('You (or someone else) kicked the device.')
  , owner_change: gettext('Someone stole your device.')
  , automatic_timeout: gettext('Device was kicked by automatic timeout.')
  , device_absent: gettext('Device is not present anymore for some reason.')
  , status_change: gettext('Device is present but offline.')
}

export const batteryHealths: Record<string, string> = {
  cold: gettext('Cold')
  , good: gettext('Good')
  , dead: gettext('Dead')
  , over_voltage: gettext('Over Voltage')
  , overheat: gettext('Overheat')
  , unspecified_failure: gettext('Unspecified Failure')
}

export const batterySources: Record<string, string> = {
  ac: gettext('AC')
  , usb: gettext('USB')
  , wireless: gettext('Wireless')
}

export const batteryStatuses: Record<string, string> = {
  charging: gettext('Charging')
  , discharging: gettext('Discharging')
  , full: gettext('Full')
  , not_charging: gettext('Not Charging')
}

export const displayDensities: Record<string, string> = {
  '0.5': 'LDPI'
  , '1': 'MDPI'
  , '1.5': 'HDPI'
  , '2': 'XHDPI'
  , '3': 'XXHDPI'
  , '4': 'XXXHDPI'
}

export const networkTypes: Record<string, string> = {
  bluetooth: gettext('Bluetooth')
  , dummy: gettext('Dummy')
  , ethernet: gettext('Ethernet')
  , mobile: gettext('Mobile')
  , mobile_dun: gettext('Mobile DUN')
  , mobile_hipri: gettext('Mobile High Priority')
  , mobile_mms: gettext('Mobile MMS')
  , mobile_supl: gettext('Mobile SUPL')
  , mobile_wifi: gettext('WiFi')
  , wimax: gettext('WiMAX')
}

export function statusNameAction(state: string): string {
  return translate(stateActions[state as DeviceState] || gettext('Unknown'))
}

export function statusNamePassive(state: string): string {
  return translate(statePassives[state as DeviceState] || gettext('Unknown'))
}

export function likelyLeaveReason(reason?: string): string {
  return translate((reason && likelyLeaveReasons[reason]) || gettext('Unknown reason.'))
}

export function humanizedBool(value: unknown): string {
  if (value === true) {
    return translate(gettext('Yes'))
  }
  if (value === false) {
    return translate(gettext('No'))
  }
  return '-'
}

function lookup(table: Record<string, string>, key?: string | null): string {
  return key && table[key] ? translate(table[key]) : '-'
}

// iOS units report PREPARING (6) while WebDriverAgent starts; once the device is present the fork
// UI treats it as ONLINE (3), as the AngularJS UI did by rewriting the status.
function effectiveStatus(device: Device): number | undefined {
  return device.ios && device.present && device.status === 6 ? 3 : device.status
}

export function computeState(device: Device): DeviceState {
  if (!device.present) {
    return 'absent'
  }
  if (device.using && device.owner) {
    return device.usage === 'automation' ? 'automation' : 'using'
  }
  switch (effectiveStatus(device)) {
    case 1:
      return 'offline'
    case 2:
    case 5:
      return 'unauthorized'
    case 6:
      return 'preparing'
    case 7:
      return 'unhealthy'
    case 3:
      if (!device.ready) {
        return 'preparing'
      }
      if (device.using) {
        return device.usage === 'automation' ? 'automation' : 'using'
      }
      return device.owner ? 'busy' : 'available'
    default:
      return 'present'
  }
}

export function userProfileUrl(email?: string): string | undefined {
  if (!email) {
    return undefined
  }
  const template = appState.config.userProfileUrl
  if (template) {
    return template.indexOf('{user}') !== -1 ?
      template.replace('{user}', email) :
      template + email
  }
  if (email.indexOf('@') !== -1) {
    return `mailto:${email}`
  }
  return `/#/user/${email}`
}

export function enhanceDevice(device: Device): Device {
  const state = computeState(device)
  device.usable = Boolean(device.present && effectiveStatus(device) === 3 && device.ready &&
    (!device.owner || device.using))

  if (!device.usable || !device.owner) {
    device.using = false
  }

  device.state = state
  device.enhancedName = device.name || device.model || device.product || device.marketName || device.serial ||
    'Unknown'
  device.enhancedModel = device.enhancedName
  const icon = device.platform || device.image || '_default.jpg'
  device.enhancedImage120 = `/static/app/devices/icon/x120/${icon}`
  device.enhancedImage24 = `/static/app/devices/icon/x24/${icon}`
  device.enhancedStateAction = statusNameAction(device.state)
  device.enhancedStatePassive = statusNamePassive(device.state)

  if (device.battery) {
    device.enhancedBatteryPercentage =
      `${device.battery.level / device.battery.scale * 100}%`
    device.enhancedBatteryHealth = lookup(batteryHealths, device.battery.health)
    device.enhancedBatterySource = lookup(batterySources, device.battery.source)
    device.enhancedBatteryStatus = lookup(batteryStatuses, device.battery.status)
    device.enhancedBatteryTemp = `${device.battery.temp}°C`
  }

  if (device.owner) {
    device.enhancedUserProfileUrl = userProfileUrl(device.owner.email)
    device.enhancedUserName = device.owner.name || 'No name'
  }

  device.enhancedGroupOwnerProfileUrl = userProfileUrl(device.group?.owner?.email)

  return device
}
