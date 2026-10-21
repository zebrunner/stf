// Fork (Zebrunner): the Wi-Fi link of an iOS device in the Network section of the Info tab
import {describe, expect, it} from 'vitest'
import type {DeviceNetwork} from '@/core/devices/types'
import {wifiRows} from './zebrunner-network'

const network = {connected: true, type: 'WIFI', subtype: null, failover: false, roaming: false}

describe('wifiRows (Zebrunner)', () => {
  it('shows SSID, signal and channel of a Wi-Fi link', () => {
    expect(wifiRows({...network, ssid: 'Lab', rssi: -40, snr: 30, channel: 36, bandwidth: 80}))
      .toEqual([
        {label: 'SSID', value: 'Lab'}
        , {label: 'Signal', value: '-40 dBm, SNR 30 dB'}
        , {label: 'Channel', value: '36 (80 MHz)'}
      ])
  })

  it('shows nothing without a Wi-Fi link, as on Android', () => {
    expect(wifiRows({...network, ssid: null} as DeviceNetwork)).toEqual([])
    expect(wifiRows(network as DeviceNetwork)).toEqual([])
    expect(wifiRows(null)).toEqual([])
  })
})
