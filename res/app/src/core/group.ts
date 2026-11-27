import {emit} from './socket'
import {createTransaction, TransactionError} from './transaction'
import type {Device} from './devices/types'

function request(action: 'group.invite' | 'group.kick', device: Device): Promise<Device> {
  const tx = createTransaction(device)
  emit(action, device.channel, tx.channel, {
    requirements: {
      serial: {
        value: device.serial
        , match: 'exact'
      }
    }
  })
  return tx.promise
    .then((result) => result.device)
    .catch((error) => {
      if (error instanceof TransactionError) {
        throw new Error('Device refused to join the group')
      }
      throw error
    })
}

// Fork (Zebrunner): the devices this browser released (Stop Using, the device list) since it last took them: the
// control page of such a device must not take it again when it sees it become available (its "lost device" rejoin,
// which is for a device a test held and gave back), or Stop Using would end with the device owned again
const released = new Set<string>()

export function releasedHere(serial: string): boolean {
  return released.has(serial)
}

export function inviteDevice(device: Device): Promise<Device> {
  if (!device.usable) {
    return Promise.reject(new Error('Device is not usable'))
  }
  released.delete(device.serial)
  return request('group.invite', device)
}

export function kickDevice(device: Device, force = false): Promise<Device> {
  if (!force && !device.usable) {
    return Promise.reject(new Error('Device is not usable'))
  }
  released.add(device.serial)
  return request('group.kick', device)
}
