// Fork (Zebrunner): the app shortcuts of the device dashboard
import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import {AppsCard} from './AppsCard'

beforeAll(() => {
  // jsdom has no matchMedia, Mantine asks for the color scheme with it
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
})

afterEach(() => {
  cleanup()
})

function renderCard(target: Record<string, unknown>) {
  const control = {
    target: {serial: 'serial', ...target}
    , shell: vi.fn(() => Promise.resolve())
    , openSettings: vi.fn()
    , openStore: vi.fn(() => Promise.resolve())
  }
  render(
    <MantineProvider>
      <AppsCard control={control as unknown as Control} />
    </MantineProvider>
  )
  return control
}

describe('AppsCard (Zebrunner)', () => {
  it('opens Settings and its pages on iOS, without Android activities', () => {
    const control = renderCard({ios: true, platform: 'iOS'})
    fireEvent.click(screen.getByText('Settings'))
    fireEvent.click(screen.getByText('WiFi'))
    fireEvent.click(screen.getByText('Manage Apps'))
    fireEvent.click(screen.getByText('Developer'))
    expect(control.openSettings.mock.calls).toEqual([[undefined], ['wifi'], ['storage'], ['developer']])
    expect(control.shell).not.toHaveBeenCalled()
  })

  it('has only Settings and the App Store on tvOS', () => {
    const control = renderCard({ios: true, platform: 'tvOS'})
    fireEvent.click(screen.getByText('WiFi'))
    fireEvent.click(screen.getByText('Developer'))
    expect(control.openSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Settings'))
    expect(control.openSettings).toHaveBeenCalledWith(undefined)
  })

  it('opens the developer options by their action, the same on every vendor (#796)', () => {
    const control = {target: {serial: 'serial'}, shell: vi.fn(() => Promise.resolve())}
    render(
      <MantineProvider>
        <AppsCard control={control as unknown as Control} />
      </MantineProvider>
    )
    fireEvent.click(screen.getByText('Developer'))
    expect(control.shell).toHaveBeenCalledWith(
      'am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS --activity-clear-top'
    )
  })
})
