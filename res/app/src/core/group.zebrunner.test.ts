// Fork (Zebrunner): the devices this browser released, which the control page does not take again
import {describe, expect, it, vi} from 'vitest'
import type {Device} from './devices/types'

const emitted: unknown[][] = []

vi.mock('./socket', () => ({
  emit: (...args: unknown[]) => {
    emitted.push(args)
  }
}))

vi.mock('./transaction', () => ({
  createTransaction: () => ({channel: 'tx', promise: Promise.resolve({device: {serial: 'serial'}})})
  , TransactionError: class extends Error {}
}))

const {inviteDevice, kickDevice, releasedHere} = await import('./group')

describe('releasedHere (Zebrunner)', () => {
  const device = {serial: 'serial', channel: 'channel', usable: true} as Device

  it('marks a device released by Stop Using until it is taken again', async() => {
    expect(releasedHere('serial')).toBe(false)
    await kickDevice(device)
    expect(releasedHere('serial')).toBe(true)
    expect(releasedHere('other')).toBe(false)
    await inviteDevice(device)
    expect(releasedHere('serial')).toBe(false)
    expect(emitted.map((args) => args[0])).toEqual(['group.kick', 'group.invite'])
  })

  it('does not mark a device it could not release', async() => {
    await expect(kickDevice({...device, serial: 'busy', usable: false})).rejects.toThrow('not usable')
    expect(releasedHere('busy')).toBe(false)
  })
})
