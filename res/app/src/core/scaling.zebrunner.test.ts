// Fork (Zebrunner): the touch coordinates of iOS devices, which swap the axes in landscape
import {describe, expect, it} from 'vitest'
import {scalingCoordinator} from './scaling'

describe('scalingCoordinator (Zebrunner)', () => {
  const scaler = scalingCoordinator(1080, 1920)

  it('maps the top left corner of a landscape iOS screen', () => {
    const point = scaler.coords(1920, 1080, 0, 0, 90, true)
    expect(point.xP).toBeCloseTo(0)
    expect(point.yP).toBeCloseTo(0)
  })

  it('keeps the Android coordinates when the device is not iOS', () => {
    expect(scaler.coords(1080, 1920, 540, 960, 0, false)).toEqual(scaler.coords(1080, 1920, 540, 960, 0))
  })
})
