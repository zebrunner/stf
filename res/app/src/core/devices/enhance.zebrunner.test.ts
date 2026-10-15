// Fork (Zebrunner): the naming, icons and statuses of iOS/tvOS devices
import {describe, expect, it} from 'vitest'
import {enhanceDevice} from './enhance'
import type {Device} from './types'

function device(overrides: Partial<Device>): Device {
  return {
    serial: 'serial'
    , present: true
    , ready: true
    , status: 3
    , channel: 'channel'
    , group: {id: 'g', name: 'g', owner: {email: 'owner@example.com'}}
    , ...overrides
  } as Device
}

describe('enhanceDevice (Zebrunner)', () => {
  it('names an iOS device and treats its preparing status as online', () => {
    const ios = enhanceDevice(device({
      ios: true
      , platform: 'iOS'
      , name: 'Custom'
      , model: 'iPhone'
      , product: 'Product'
      , marketName: 'Market'
      , status: 6
      , state: 'present'
    }))
    expect(ios.enhancedName).toBe('Custom')
    expect(ios.enhancedModel).toBe('Custom')
    expect(ios.enhancedImage24).toBe('/static/app/devices/icon/x24/iOS')
    expect(ios.state).toBe('available')
    expect(ios.enhancedStatePassive).toBe('Available')

    expect(ios.usable).toBe(true)

    // The previous state must not stick: another user taking the device makes it busy
    const taken = enhanceDevice({...ios, owner: {email: 'other@example.com'}, using: false})
    expect(taken.state).toBe('busy')
    expect(taken.usable).toBe(false)

    const offline = enhanceDevice({...ios, status: 1, owner: null})
    expect(offline.state).toBe('offline')
    expect(offline.usable).toBe(false)

    const notReady = enhanceDevice({...ios, status: 3, ready: false, owner: null})
    expect(notReady.state).toBe('preparing')

    const absentIos = enhanceDevice({...ios, present: false})
    expect(absentIos.state).toBe('absent')

    const unhealthy = enhanceDevice(device({status: 7}))
    expect(unhealthy.state).toBe('unhealthy')
    expect(unhealthy.enhancedStatePassive).toBe('Unhealthy')
  })

  it('names a device by its model before its market name', () => {
    const named = enhanceDevice(device({marketName: 'Galaxy', model: 'SM-1'}))
    expect(named.enhancedName).toBe('SM-1')
  })

  it('shows the device a user automates or uses', () => {
    const owner = {email: 'owner@example.com'}
    expect(enhanceDevice(device({using: true, owner, usage: 'automation'})).state).toBe('automation')
    expect(enhanceDevice(device({using: true, owner})).state).toBe('using')
  })
})
