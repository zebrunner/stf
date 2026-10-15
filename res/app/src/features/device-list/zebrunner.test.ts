// Fork (Zebrunner): the remembered filter of the device list
import {renderHook} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'
import {readStoredDeviceFilter, useStoredDeviceFilter} from './zebrunner'

describe('device list filter (Zebrunner)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('reads the stored filter', () => {
    window.localStorage.setItem('deviceFilter', 'platform: iOS')
    expect(readStoredDeviceFilter()).toBe('platform: iOS')
  })

  it('reads the filter of the AngularJS UI', () => {
    window.localStorage.setItem('deviceFilters', JSON.stringify([{field: 'model', query: 'iPhone'}]))
    expect(readStoredDeviceFilter()).toBe('model: iPhone')
    window.localStorage.setItem('deviceFilters', JSON.stringify([{query: 'Pixel'}]))
    expect(readStoredDeviceFilter()).toBe('Pixel')
  })

  it('starts without a filter when nothing or garbage is stored', () => {
    expect(readStoredDeviceFilter()).toBe('')
    window.localStorage.setItem('deviceFilters', '{broken')
    expect(readStoredDeviceFilter()).toBe('')
  })

  it('stores the filter and forgets it when it is cleared', () => {
    const {rerender} = renderHook(({search}) => useStoredDeviceFilter(search), {
      initialProps: {search: 'serial: abc'}
    })
    expect(window.localStorage.getItem('deviceFilter')).toBe('serial: abc')
    rerender({search: ''})
    expect(window.localStorage.getItem('deviceFilter')).toBe(null)
    expect(window.localStorage.getItem('deviceFilters')).toBe('[]')
  })
})
