// Fork (Zebrunner): the filters of the columns zebrunner/stf#889 reported as not filtering
import {describe, expect, it} from 'vitest'
import type {Device} from '@/core/devices/types'
import {matchDevice} from './list-model'
import {parseQuery} from './query-parser'

const columns = ['state', 'sdk', 'releasedAt', 'batteryTemp', 'batteryLevel']

const pixel = {
  serial: 'pixel'
  , state: 'available'
  , sdk: '34'
  , releasedAt: '2023-05-10T00:00:00Z'
  , battery: {level: 80, scale: 100, temp: 31}
} as unknown as Device

const galaxy = {
  serial: 'galaxy'
  , state: 'using'
  , sdk: '21'
  , releasedAt: '2014-04-11T00:00:00Z'
  , battery: {level: 15, scale: 100, temp: 42}
} as unknown as Device

function matching(query: string): string[] {
  return [pixel, galaxy]
    .filter((device) => matchDevice(device, parseQuery(query), columns, 'en'))
    .map((device) => device.serial)
}

describe('device list filters (Zebrunner, #889)', () => {
  it('filters by the selected columns without a field name', () => {
    expect(matching('available')).toEqual(['pixel'])
    expect(matching('21')).toEqual(['galaxy'])
  })

  it('filters by state and SDK', () => {
    expect(matching('state:using')).toEqual(['galaxy'])
    expect(matching('sdk:>=31')).toEqual(['pixel'])
  })

  it('filters by the release date', () => {
    expect(matching('releasedAt:>2020-01-01')).toEqual(['pixel'])
  })

  it('filters by the battery level and temperature', () => {
    expect(matching('batteryLevel:<20')).toEqual(['galaxy'])
    expect(matching('batteryTemp:>40')).toEqual(['galaxy'])
  })
})
