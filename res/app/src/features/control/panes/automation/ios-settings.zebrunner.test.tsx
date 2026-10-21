// Fork (Zebrunner): the iOS controls of the device page: Wi-Fi and Bluetooth through Settings, the
// go-ios shell and no port forwarding
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {MemoryRouter} from 'react-router'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import AdvancedPane from '../advanced/AdvancedPane'
import {ShellCard} from '../dashboard/shell/ShellCard'
import {IosDeviceSettingsCard} from './zebrunner-ios-settings'

beforeAll(() => {
  // jsdom has no matchMedia and ResizeObserver, Mantine uses them
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false
    , media: query
    , onchange: null
    , addListener: () => {}
    , removeListener: () => {}
    , addEventListener: () => {}
    , removeEventListener: () => {}
    , dispatchEvent: () => false
  }))
  window.ResizeObserver = window.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
})

function iosControl(overrides: Record<string, unknown> = {}) {
  return {
    target: {serial: 'udid-1', ios: true}
    , getWifiStatus: vi.fn(() => Promise.resolve({lastData: 'wifi_enabled'}))
    , setWifiEnabled: vi.fn((enabled: boolean) =>
      Promise.resolve({lastData: enabled ? 'wifi_enabled' : 'wifi_disabled'}))
    , getBluetoothStatus: vi.fn(() => Promise.resolve({lastData: 'bluetooth_disabled'}))
    , setBluetoothEnabled: vi.fn((enabled: boolean) =>
      Promise.resolve({lastData: enabled ? 'bluetooth_enabled' : 'bluetooth_disabled'}))
    , getRingerMode: vi.fn(() => new Promise(() => {}))
    , ...overrides
  }
}

function checked(index: number, value: 'true' | 'false'): boolean {
  const group = screen.getAllByRole('radiogroup')[index]!
  return (group.querySelector(`input[value="${value}"]`) as HTMLInputElement).checked
}

describe('IosDeviceSettingsCard (Zebrunner)', () => {
  it('reads the state of a radio only on demand, since Settings takes the screen', async() => {
    const control = iosControl()
    render(
      <MantineProvider>
        <IosDeviceSettingsCard control={control as unknown as Control} />
      </MantineProvider>
    )
    expect(control.getWifiStatus).not.toHaveBeenCalled()
    expect(control.getBluetoothStatus).not.toHaveBeenCalled()
    expect(checked(0, 'true')).toBe(false)
    expect(checked(0, 'false')).toBe(false)

    fireEvent.click(screen.getAllByLabelText('Read the state from the device')[0]!)
    expect(control.getWifiStatus).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(checked(0, 'true')).toBe(true))
    expect(control.getBluetoothStatus).not.toHaveBeenCalled()
  })

  it('turns a radio on and off with the state the device answers', async() => {
    const control = iosControl()
    render(
      <MantineProvider>
        <IosDeviceSettingsCard control={control as unknown as Control} />
      </MantineProvider>
    )
    fireEvent.click(screen.getAllByText('On')[1]!)
    expect(control.setBluetoothEnabled).toHaveBeenCalledWith(true)
    await waitFor(() => expect(checked(1, 'true')).toBe(true))

    fireEvent.click(screen.getAllByText('Off')[0]!)
    expect(control.setWifiEnabled).toHaveBeenCalledWith(false)
    await waitFor(() => expect(checked(0, 'false')).toBe(true))
  })
})

describe('ShellCard (Zebrunner)', () => {
  it('runs go-ios commands on an iOS device', () => {
    const control = iosControl()
    render(
      <MemoryRouter>
        <MantineProvider>
          <ShellCard control={control as unknown as Control} />
        </MantineProvider>
      </MemoryRouter>
    )
    expect(screen.getByText('$ ios')).toBeTruthy()
    expect(screen.getByText('Runs go-ios commands, e.g. apps --list')).toBeTruthy()
  })
})

describe('AdvancedPane (Zebrunner)', () => {
  function renderPane(device: Partial<Device>) {
    const control = iosControl({
      target: device
      , keyPress: vi.fn()
      , reboot: vi.fn(() => Promise.resolve())
    })
    render(
      <MemoryRouter>
        <MantineProvider>
          <AdvancedPane device={device as Device} control={control as unknown as Control} />
        </MantineProvider>
      </MemoryRouter>
    )
  }

  it('has the iOS device settings and no port forwarding on iOS', () => {
    renderPane({serial: 'udid-1', ios: true, platform: 'iOS'})
    expect(screen.getAllByLabelText('Read the state from the device')).toHaveLength(2)
    expect(screen.queryByText('Port Forwarding')).toBeNull()
    expect(screen.queryByText('Manner Mode')).toBeNull()
  })

  it('has no device settings on tvOS', () => {
    renderPane({serial: 'udid-2', ios: true, platform: 'tvOS'})
    expect(screen.queryByText('Device Settings')).toBeNull()
    expect(screen.queryByText('Port Forwarding')).toBeNull()
  })
})
