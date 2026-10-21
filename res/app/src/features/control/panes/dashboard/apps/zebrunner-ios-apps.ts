// Fork (Zebrunner): the shortcuts of the Apps card on iOS open Settings and its pages through WDA
// (lib/units/ios-device/plugins/wda/settings.ts) instead of Android activities; tvOS has only
// Settings
import type {Control} from '@/core/control'

const iosPages: Record<string, string | null> = {
  Settings: null
  , WiFi: 'wifi'
  , 'Manage Apps': 'storage'
  , Developer: 'developer'
}

function isTvos(control: Control): boolean {
  return control.target.platform === 'tvOS'
}

// iosShortcutDisabled <control> <title>: whether the shortcut has nothing to open on the device
export function iosShortcutDisabled(control: Control, title: string): boolean {
  return isTvos(control) && Boolean(iosPages[title])
}

// openIosShortcut <control> <title>: opens the shortcut on an iOS device, null for the other ones
export function openIosShortcut(control: Control, title: string): Promise<unknown> | null {
  if (!control.target.ios || !(title in iosPages)) {
    return null
  }
  control.openSettings(iosPages[title] || undefined)
  return Promise.resolve()
}
