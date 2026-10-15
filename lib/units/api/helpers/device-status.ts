/**
* Fork (Zebrunner): the device status the Zebrunner device management sets with
* PUT /devices/{serial}, see lib/units/api/controllers/devices.ts.
**/

import type Promise from 'bluebird'

import dbapi from '../../../db/api.js'
import type {DevicePayload} from '../../../types/units-api.js'

// The DeviceStatus values of lib/wire/wire.proto
const STATUS_CODES: Record<string, number> = {
  offline: 1
, unauthorized: 5
, preparing: 6
, unhealthy: 7
}

const ONLINE = 3

// updates <serial> <body>: the database writes of the status of the body, or the message of a
// 400 answer
function updates(serial: string, body: DevicePayload): Promise<unknown>[] | string {
  const status = (body.status || '').trim().toLowerCase()

  switch (status) {
  case 'disconnected':
    return [dbapi.setDeviceAbsent(serial)]
  case 'available':
    return [
      dbapi.setDeviceStatusOverride(serial, ONLINE)
    , dbapi.unsetDeviceOwner(serial)
    , dbapi.unmarkDeviceAsUsing(serial)
    ]
  case 'busy':
    if (typeof body.owner?.name !== 'string' || !body.owner.name.trim()) {
      return 'Missing owner.name for busy status'
    }
    return [
      dbapi.setDeviceStatusOverride(serial, ONLINE)
    , dbapi.setDeviceOwner(serial, {
        name: body.owner.name
      , email: body.owner.email || ''
      , group: ''
      })
    , dbapi.markDeviceAsUsing(serial)
    ]
  default:
    if (Object.hasOwn(STATUS_CODES, status)) {
      return [dbapi.setDeviceStatusOverride(serial, STATUS_CODES[status]!)]
    }
    return 'Unknown status requested'
  }
}

export default {updates}
