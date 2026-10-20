// Fork (Zebrunner): the messages of the fork that come from the UI
import wire from './index.js'

export interface TouchPathIosPointFields {
  x: number
  y: number
  t: number
}

export interface TouchPathIosContactFields {
  points: TouchPathIosPointFields[]
}

var MAX_CONTACTS = 5
var MAX_POINTS = 1000
var MAX_TIME = 60000

function point(value: unknown): TouchPathIosPointFields | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  var {x, y, t} = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || typeof t !== 'number' ||
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) {
    return null
  }
  return {
    x: Math.min(Math.max(x, 0), 1)
  , y: Math.min(Math.max(y, 0), 1)
  , t: Math.round(Math.min(Math.max(t, 0), MAX_TIME))
  }
}

// touchPathIosContacts <contacts>: the fingers of a gesture of the UI (input.touchPathIos) for
// TouchPathIosMessage, the points that are not numbers are dropped
export function touchPathIosContacts(contacts: unknown): TouchPathIosContactFields[] {
  if (!Array.isArray(contacts)) {
    return []
  }
  return contacts.slice(0, MAX_CONTACTS).map(function(contact: unknown) {
    var points = contact && typeof contact === 'object' ?
      (contact as {points?: unknown}).points :
      null
    return {
      points: (Array.isArray(points) ? points.slice(0, MAX_POINTS) : [])
        .map(point)
        .filter(function(value): value is TouchPathIosPointFields {
          return value !== null
        })
    }
  }).filter(function(contact) {
    return contact.points.length > 0
  })
}

// touchPathIosMessage <contacts>: TouchPathIosMessage of a gesture of the UI (input.touchPathIos)
export function touchPathIosMessage(contacts: unknown) {
  return new wire.TouchPathIosMessage(touchPathIosContacts(contacts).map(function(contact) {
    return new wire.TouchPathIosContact(contact.points.map(function(value) {
      return new wire.TouchPathIosPoint(value.x, value.y, value.t)
    }))
  }))
}
