// Fork (Zebrunner): the app shortcuts of the device dashboard
import {fireEvent, render, screen} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {beforeAll, describe, expect, it, vi} from 'vitest'
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

describe('AppsCard (Zebrunner)', () => {
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
