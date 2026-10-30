// Fork (Zebrunner): Settings > Devices tells why a device was not removed: the API answers success
// ("Unchanged") for a device the removing filters skip, e.g. one that stays controlled after its
// host went away during a session
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {ModalsProvider} from '@mantine/modals'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import DevicesSettings from './DevicesSettings'

vi.mock('./settings-devices', () => ({
  useSettingsDevices: () => ({
    devices: [{serial: 'serial1', model: 'iPhone 15', manufacturer: 'Apple'}]
    , loading: false
    , error: null
  })
}))

const unchangedDevice = 'The device was not removed: it does not match the removing filters (present, ' +
  'booked, annotated, controlled). A device whose host went away during a session stays controlled: ' +
  'set the filters to Any to remove it.'
const unchangedDevices = 'No device was removed: none matches the removing filters (present, booked, ' +
  'annotated, controlled). A device whose host went away during a session stays controlled: set the ' +
  'filters to Any to remove it.'

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
  vi.unstubAllGlobals()
})

function answer(description: string) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({success: true, description}))))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function remove(button: string) {
  const {container} = render(
    <MantineProvider>
      <ModalsProvider>
        <DevicesSettings />
      </ModalsProvider>
    </MantineProvider>
  )
  fireEvent.click(container.querySelector(button)!)
  fireEvent.click(await screen.findByText('OK'))
}

describe('DevicesSettings (Zebrunner)', () => {
  it('tells why a device the removing filters skip was not removed', async() => {
    const fetch = answer('Unchanged (device)')
    await remove('.device-remove')
    expect(await screen.findByText(unchangedDevice)).toBeTruthy()
    expect(fetch.mock.calls[0]![0]).toBe(
      '/api/v1/devices/serial1?present=false&booked=false&annotated=false&controlled=false')
    expect(fetch.mock.calls[0]![1]!.method).toBe('DELETE')
  })

  it('tells why no device of the selection was removed', async() => {
    const fetch = answer('Unchanged (devices)')
    await remove('.device-remove-selection')
    expect(await screen.findByText(unchangedDevices)).toBeTruthy()
    expect(fetch.mock.calls[0]![0]).toBe(
      '/api/v1/devices?present=false&booked=false&annotated=false&controlled=false')
  })

  it('says nothing more once the device is removed', async() => {
    const fetch = answer('Deleted (device)')
    await remove('.device-remove')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(unchangedDevice)).toBeNull()
  })
})
