// Fork (Zebrunner): the whole gestures of the UI (TouchPathIosMessage) replayed through WDA. iOS
// takes no live touches without a jailbreak, so the UI records the path of every finger with its
// timing and the unit replays it at once, as W3C actions, when the gesture ends
import Promise from 'bluebird'

import logger from '../../../../util/logger.js'
import request from '../util/rp.js'
import type {
  IosDeviceSize
, IosOrientation
, WdaClientPlugin
} from '../../../../types/ios-device.js'

var log = logger.createLogger('wda:gesture')

export interface PathPoint {
  x: number
  y: number
  t: number
}

interface PathContact {
  points?: PathPoint[] | null
}

type W3cAction =
  {type: 'pointerMove', duration: number, x: number, y: number}
| {type: 'pointerDown' | 'pointerUp', button: 0}
| {type: 'pause', duration: number}

export interface W3cSource {
  type: 'pointer'
  id: string
  parameters: {pointerType: 'touch'}
  actions: W3cAction[]
}

// The points of a finger are put on ticks of TICK ms, the ticks of all the fingers are shared
export var TICK = 16
export var MAX_CONTACTS = 5
export var MAX_POINTS = 1000
// A gesture of the UI is not longer than that
export var MAX_DURATION = 60000
// WDA takes about 0.25 s for every pointerMove (it resolves the coordinate of the application
// with an accessibility snapshot; 0.05 s with the settings of fast-input.ts), so a gesture keeps at
// most MAX_TICKS ticks; a tick that puts
// no finger farther than TOLERANCE points from the straight moves around it is dropped
export var MAX_TICKS = 6
export var TOLERANCE = 3

function valid(point: PathPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.t) &&
    point.t >= 0 && point.t <= MAX_DURATION
}

function clamp(value: number, max: number): number {
  return Math.round(Math.min(Math.max(value, 0), Math.max(max - 1, 0)))
}

// toDevice <orientation> <size> <point>: the point of the screen (from 0 to 1) in the points of
// WDA, the same way as iosutil.swipe
export function toDevice(
  orientation: IosOrientation | null
, size: IosDeviceSize
, point: PathPoint
): PathPoint {
  if (orientation === 'LANDSCAPE') {
    return {
      x: clamp(point.y * size.height, size.height)
    , y: clamp(point.x * size.width, size.width)
    , t: point.t
    }
  }
  return {
    x: clamp(point.x * size.width, size.width)
  , y: clamp(point.y * size.height, size.height)
  , t: point.t
  }
}

// positionAt <points> <t>: where a finger is at the time, between two of its points
function positionAt(points: PathPoint[], t: number): {x: number, y: number} {
  for (var i = 1; i < points.length; ++i) {
    var next = points[i]!
    if (next.t >= t) {
      var prev = points[i - 1]!
      var k = next.t === prev.t ? 1 : (t - prev.t) / (next.t - prev.t)
      return {
        x: Math.round(prev.x + (next.x - prev.x) * k)
      , y: Math.round(prev.y + (next.y - prev.y) * k)
      }
    }
  }
  var last = points[points.length - 1]!
  return {x: last.x, y: last.y}
}

// normalize <contacts> <map>: the points of the fingers on the ticks, a later point of the same
// tick replaces the earlier one; the fingers without points are dropped
export function normalize(
  contacts: PathContact[]
, map: (point: PathPoint) => PathPoint
): PathPoint[][] {
  return contacts.slice(0, MAX_CONTACTS).map(function(contact) {
    var points: PathPoint[] = []
    for (var point of (contact.points || []).slice(0, MAX_POINTS).filter(valid)) {
      var mapped = map(point)
      var t = Math.round(point.t / TICK) * TICK
      var last = points[points.length - 1]
      if (last && t <= last.t) {
        points[points.length - 1] = {x: mapped.x, y: mapped.y, t: last.t}
      }
      else {
        points.push({x: mapped.x, y: mapped.y, t: t})
      }
    }
    return points
  }).filter(function(points) {
    return points.length > 0
  })
}

function ticksOf(paths: PathPoint[][]): number[] {
  return Array.from(new Set(paths.flatMap(function(points) {
    return points.map(function(point) {
      return point.t
    })
  }))).sort(function(a, b) {
    return a - b
  })
}

// track <points> <times>: where a finger is at the sorted times
function track(points: PathPoint[], times: number[]): Array<{x: number, y: number}> {
  var i = 0
  return times.map(function(t) {
    while (i < points.length - 1 && points[i + 1]!.t < t) {
      ++i
    }
    var prev = points[i]!
    var next = points[Math.min(i + 1, points.length - 1)]!
    if (t <= prev.t || next === prev) {
      return {x: prev.x, y: prev.y}
    }
    if (t >= next.t) {
      return {x: next.x, y: next.y}
    }
    var k = (t - prev.t) / (next.t - prev.t)
    return {
      x: Math.round(prev.x + (next.x - prev.x) * k)
    , y: Math.round(prev.y + (next.y - prev.y) * k)
    }
  })
}

// simplify <paths> [maxTicks] [tolerance]: the paths on fewer shared ticks. The touches and the
// releases of the fingers stay, then the tick where a finger is the farthest (in space and time)
// from the straight move between the kept ticks is added while it is farther than the tolerance
export function simplify(
  paths: PathPoint[][]
, maxTicks: number = MAX_TICKS
, tolerance: number = TOLERANCE
): PathPoint[][] {
  var times = ticksOf(paths)
  var index = new Map(times.map(function(t, i) {
    return [t, i] as const
  }))
  var spans = paths.map(function(points) {
    return {from: index.get(points[0]!.t)!, to: index.get(points[points.length - 1]!.t)!}
  })
  var positions = paths.map(function(points) {
    return track(points, times)
  })
  var kept = times.map(function() {
    return false
  })
  spans.forEach(function(span) {
    kept[span.from] = true
    kept[span.to] = true
  })
  var count = kept.filter(Boolean).length

  // deviation <f> <n> <from> <to>: how far the finger is at the tick from its straight move
  // between the kept ticks around it
  function deviation(f: number, n: number, from: number, to: number): number {
    var span = spans[f]!
    if (n <= span.from || n >= span.to) {
      return 0
    }
    var a = positions[f]![from]!
    var b = positions[f]![to]!
    var p = positions[f]![n]!
    var k = (times[n]! - times[from]!) / (times[to]! - times[from]!)
    return Math.hypot(a.x + (b.x - a.x) * k - p.x, a.y + (b.y - a.y) * k - p.y)
  }

  while (count < maxTicks) {
    var prev: number[] = []
    var next: number[] = []
    for (var i = 0, last = -1; i < times.length; ++i) {
      last = kept[i] ? i : last
      prev[i] = last
    }
    for (var j = times.length - 1, first = -1; j >= 0; --j) {
      first = kept[j] ? j : first
      next[j] = first
    }

    var best = -1
    var bestError = tolerance
    for (var n = 0; n < times.length; ++n) {
      for (var f = 0; !kept[n] && f < paths.length; ++f) {
        var error = deviation(f, n, prev[n]!, next[n]!)
        if (error > bestError) {
          best = n
          bestError = error
        }
      }
    }
    if (best < 0) {
      break
    }
    kept[best] = true
    ++count
  }

  return paths.map(function(_points, f) {
    var span = spans[f]!
    return times.flatMap(function(t, i) {
      return kept[i] && i >= span.from && i <= span.to ?
        [{x: positions[f]![i]!.x, y: positions[f]![i]!.y, t: t}] :
        []
    })
  })
}

// pathActions <paths>: the W3C actions of the fingers. The actions of all the sources go by
// ticks (the n-th action of every source runs at the same time), so every source has an action
// on every tick: the moves between the times of the points, then the touches and the releases
// of the fingers at that time
export function pathActions(paths: PathPoint[][]): W3cSource[] {
  var sources: W3cSource[] = paths.map(function(points, index) {
    return {
      type: 'pointer'
    , id: 'finger' + (index + 1)
    , parameters: {pointerType: 'touch'}
    , actions: [{type: 'pointerMove', duration: 0, x: points[0]!.x, y: points[0]!.y}]
    }
  })
  var times = ticksOf(paths)

  function start(points: PathPoint[]): number {
    return points[0]!.t
  }

  function end(points: PathPoint[]): number {
    return points[points.length - 1]!.t
  }

  times.forEach(function(t, index) {
    if (index > 0) {
      var duration = t - times[index - 1]!
      paths.forEach(function(points, i) {
        if (t > start(points) && t <= end(points)) {
          var position = positionAt(points, t)
          sources[i]!.actions.push({
            type: 'pointerMove'
          , duration: duration
          , x: position.x
          , y: position.y
          })
        }
        else {
          sources[i]!.actions.push({type: 'pause', duration: duration})
        }
      })
    }
    var edges = [{type: 'pointerDown', edge: start}, {type: 'pointerUp', edge: end}] as const
    edges.forEach(function({type, edge}) {
      if (paths.some(function(points) {
        return edge(points) === t
      })) {
        paths.forEach(function(points, i) {
          sources[i]!.actions.push(edge(points) === t ?
            {type: type, button: 0} :
            {type: 'pause', duration: 0})
        })
      }
    })
  })
  return sources
}

// replayPath <wdaClient> <contacts>: replays the gesture on the device. The taps of the gesture
// (touchUp, doubleClick) wait for it through isSwiping; an error of WDA is logged, it does not
// stop the unit as WdaClient.handleRequest does
export function replayPath(wdaClient: WdaClientPlugin, contacts: PathContact[]): Promise<void> {
  var size = wdaClient.deviceSize
  if (!size || !wdaClient.sessionId) {
    return Promise.resolve()
  }
  if (wdaClient.deviceType === 'Apple TV') {
    log.error('Gestures are not supported on Apple TV')
    return Promise.resolve()
  }
  if (wdaClient.isSwiping) {
    return Promise.resolve()
  }
  var orientation = wdaClient.orientation
  var paths = simplify(normalize(contacts, function(point) {
    return toDevice(orientation, size!, point)
  }))
  if (!paths.length) {
    return Promise.resolve()
  }

  var duration = Math.max(...paths.map(function(points) {
    return points[points.length - 1]!.t
  }))
  wdaClient.isSwiping = true
  return request({
    method: 'POST'
  , uri: `${wdaClient.baseUrl}/session/${wdaClient.sessionId}/actions`
  , body: {actions: pathActions(paths)}
  , json: true
  , timeout: duration + 30000
  })
    .then(function() {
      log.info('Replayed a gesture of %d finger(s), %d ms', paths.length, duration)
    })
    .catch(function(err: Error) {
      log.error('Failed to replay a gesture: %s', err.message)
    })
    .finally(function() {
      wdaClient.isSwiping = false
    })
}
