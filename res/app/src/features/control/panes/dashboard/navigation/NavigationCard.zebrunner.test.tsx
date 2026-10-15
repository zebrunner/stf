// Fork (Zebrunner): the navigation card of the device dashboard
import {fireEvent, render, screen} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {beforeAll, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {NavigationCard} from './NavigationCard'

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

function card(device: Partial<Device>) {
  const control = {
    openBrowser: vi.fn(() => Promise.resolve())
    , clearBrowser: vi.fn(() => Promise.resolve())
  }
  render(
    <MantineProvider>
      <NavigationCard
        device={{serial: 'serial', browser: {apps: [{id: 'chrome', name: 'Chrome', selected: true}]}, ...device} as Device}
        control={control as unknown as Control}
      />
    </MantineProvider>
  )
  return control
}

describe('NavigationCard (Zebrunner)', () => {
  it('clears the address when the browser is reset (#807)', () => {
    const control = card({})
    const address = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(address, {target: {value: 'zebrunner.com'}})
    expect(address.value).toBe('zebrunner.com')

    fireEvent.click(screen.getByRole('button', {name: /Reset/}))
    expect(control.clearBrowser).toHaveBeenCalledWith({id: 'chrome', name: 'Chrome', selected: true})
    expect(address.value).toBe('')
  })

  it('opens addresses on iOS 17 and later only (#140)', () => {
    card({ios: true, version: '16.7.2'})
    expect((screen.getAllByRole('textbox').at(-1) as HTMLInputElement).disabled).toBe(true)
    card({ios: true, version: '17.4'})
    expect((screen.getAllByRole('textbox').at(-1) as HTMLInputElement).disabled).toBe(false)
  })
})
