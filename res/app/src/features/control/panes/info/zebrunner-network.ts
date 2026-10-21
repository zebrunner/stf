// Fork (Zebrunner): the Wi-Fi link of an iOS device in the Network section of the Info tab, read
// from its system log (lib/units/ios-device/plugins/info/index.ts)
import {gettext} from '@/core/i18n'
import type {DeviceNetwork} from '@/core/devices/types'

export interface WifiRow {
  label: string
  value: string
}

// wifiRows <network>: SSID, signal and channel of the Wi-Fi link, none without one
export function wifiRows(network?: DeviceNetwork | null): WifiRow[] {
  if (!network?.ssid) {
    return []
  }
  const snr = typeof network.snr === 'number' ? `, SNR ${network.snr} dB` : ''
  return [
    {label: gettext('SSID'), value: network.ssid}
    , {label: gettext('Signal'), value: `${network.rssi} dBm${snr}`}
    , {label: gettext('Channel'), value: `${network.channel} (${network.bandwidth} MHz)`}
  ]
}
