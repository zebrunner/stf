// Fork (Zebrunner): the whole gestures of iOS devices. iOS takes no live touches without a
// jailbreak, so the path of every finger is recorded with its timing and sent when the gesture
// ends (control.touchPathIos), the unit replays it through WDA. The trail of the fingers is drawn
// over the screen meanwhile, so the user sees the gesture the device is going to get

export interface IosPathPoint {
  x: number
  y: number
  t: number
}

// A finger that gets no move for longer than that stood still: it stays at its point until just
// before the next one (a long press before a drag)
export const IOS_PATH_GAP_MS = 48
export const IOS_PATH_TICK_MS = 16
export const IOS_PATH_MAX_POINTS = 1000
// How far a finger has to go (a part of the screen) for a gesture instead of a tap
export const IOS_PATH_MOVE_THRESHOLD = 0.02

export class IosPath {
  private readonly startedAt: number
  private readonly fingers = new Map<number, IosPathPoint[]>()

  constructor(startedAt: number) {
    this.startedAt = startedAt
  }

  // add <contact> <x> <y> <time>: a point of a finger, x and y from 0 to 1, the time of the event
  add(contact: number, x: number, y: number, time: number) {
    const t = Math.max(0, Math.round(time - this.startedAt))
    let points = this.fingers.get(contact)
    if (!points) {
      points = []
      this.fingers.set(contact, points)
    }
    const last = points[points.length - 1]
    if (last && t - last.t > IOS_PATH_GAP_MS) {
      points.push({x: last.x, y: last.y, t: t - IOS_PATH_TICK_MS})
    }
    if (points.length >= IOS_PATH_MAX_POINTS) {
      // Every other point is dropped, the first and the last ones stay
      const kept = points.filter((_, index) => index === 0 || index % 2 === 1 || index === points!.length - 1)
      points.splice(0, points.length, ...kept)
    }
    points.push({x, y, t})
  }

  moved(threshold = IOS_PATH_MOVE_THRESHOLD): boolean {
    return this.fingers.size > 1 || Array.from(this.fingers.values()).some((points) => points.some((point) =>
      Math.abs(point.x - points[0]!.x) >= threshold || Math.abs(point.y - points[0]!.y) >= threshold
    ))
  }

  duration(): number {
    return Math.max(0, ...Array.from(this.fingers.values()).map((points) => points[points.length - 1]!.t))
  }

  contacts(): IosPathPoint[][] {
    return Array.from(this.fingers.keys()).sort((a, b) => a - b).map((contact) => this.fingers.get(contact)!)
  }
}

const SVG = 'http://www.w3.org/2000/svg'
const TRAIL_FADE_MS = 300
const TRAIL_HOLD_MS = 400

export interface IosTrail {
  // add <contact> <x> <y>: a point of a finger in the pixels of the screen element
  add(contact: number, x: number, y: number): void
  // end <duration>: the gesture is sent, its trail fades once the device has replayed it
  end(duration: number): void
  clear(): void
  destroy(): void
}

export function createIosTrail(root: HTMLElement): IosTrail {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'ios-trail')
  Object.assign(svg.style, {
    position: 'absolute'
    , left: '0'
    , top: '0'
    , width: '100%'
    , height: '100%'
    , pointerEvents: 'none'
    , overflow: 'visible'
    , zIndex: '5'
    , transition: `opacity ${TRAIL_FADE_MS}ms`
  })
  root.appendChild(svg)

  const lines = new Map<number, SVGPolylineElement>()
  let fadeTimer: ReturnType<typeof setTimeout> | null = null

  function stopFading() {
    if (fadeTimer) {
      clearTimeout(fadeTimer)
      fadeTimer = null
    }
  }

  function clear() {
    stopFading()
    lines.clear()
    svg.replaceChildren()
    svg.style.opacity = '1'
  }

  return {
    add(contact, x, y) {
      if (fadeTimer) {
        clear()
      }
      let line = lines.get(contact)
      if (!line) {
        line = document.createElementNS(SVG, 'polyline')
        line.setAttribute('fill', 'none')
        line.setAttribute('stroke', '#2b8cff')
        line.setAttribute('stroke-width', '4')
        line.setAttribute('stroke-opacity', '0.7')
        line.setAttribute('stroke-linecap', 'round')
        line.setAttribute('stroke-linejoin', 'round')
        lines.set(contact, line)
        svg.appendChild(line)
      }
      const points = line.getAttribute('points')
      line.setAttribute('points', `${points ? points + ' ' : ''}${Math.round(x)},${Math.round(y)}`)
    }
    , end(duration) {
      stopFading()
      fadeTimer = setTimeout(() => {
        svg.style.opacity = '0'
        fadeTimer = setTimeout(clear, TRAIL_FADE_MS)
      }, duration + TRAIL_HOLD_MS)
    }
    , clear
    , destroy() {
      stopFading()
      svg.remove()
    }
  }
}
