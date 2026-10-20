// Fork (Zebrunner): the whole gestures of iOS devices, recorded with their timing and sent when
// they end, and the trail of the fingers over the screen
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {ScalingCoordinator} from '@/core/scaling'
import {IOS_PATH_MAX_POINTS, IosPath, createIosTrail} from './ios-gesture'
import {bindScreenTouch} from './screen-touch'

describe('IosPath (Zebrunner)', () => {
  it('records the points of the fingers with their time from the start', () => {
    const path = new IosPath(1000)
    path.add(0, 0.5, 0.8, 1000)
    path.add(0, 0.5, 0.6, 1016)
    path.add(0, 0.5, 0.4, 1032.4)
    expect(path.contacts()).toEqual([[
      {x: 0.5, y: 0.8, t: 0}
      , {x: 0.5, y: 0.6, t: 16}
      , {x: 0.5, y: 0.4, t: 32}
    ]])
    expect(path.duration()).toBe(32)
    expect(path.moved()).toBe(true)
  })

  it('keeps a finger at its point while it stands still', () => {
    const path = new IosPath(0)
    path.add(0, 0.1, 0.1, 0)
    path.add(0, 0.2, 0.1, 1000)
    expect(path.contacts()[0]).toEqual([
      {x: 0.1, y: 0.1, t: 0}
      , {x: 0.1, y: 0.1, t: 984}
      , {x: 0.2, y: 0.1, t: 1000}
    ])
  })

  it('tells a tap from a gesture', () => {
    const tap = new IosPath(0)
    tap.add(0, 0.5, 0.5, 0)
    tap.add(0, 0.505, 0.5, 100)
    expect(tap.moved()).toBe(false)

    const pinch = new IosPath(0)
    pinch.add(0, 0.5, 0.5, 0)
    pinch.add(1, 0.5, 0.5, 0)
    expect(pinch.moved()).toBe(true)
  })

  it('drops every other point of a long gesture', () => {
    const path = new IosPath(0)
    for (let i = 0; i <= IOS_PATH_MAX_POINTS + 10; ++i) {
      path.add(0, i / 10000, 0, i * 16)
    }
    const [points] = path.contacts()
    expect(points!.length).toBeLessThanOrEqual(IOS_PATH_MAX_POINTS)
    expect(points![0]).toEqual({x: 0, y: 0, t: 0})
    expect(points![points!.length - 1]!.t).toBe((IOS_PATH_MAX_POINTS + 10) * 16)
  })
})

describe('createIosTrail (Zebrunner)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('draws a line per finger and fades it after the gesture', () => {
    const root = document.createElement('div')
    const trail = createIosTrail(root)
    trail.add(0, 10, 20)
    trail.add(0, 30.4, 40)
    trail.add(1, 5, 5)
    const lines = root.querySelectorAll('svg.ios-trail polyline')
    expect(lines).toHaveLength(2)
    expect(lines[0]!.getAttribute('points')).toBe('10,20 30,40')

    trail.end(500)
    vi.advanceTimersByTime(800)
    expect(root.querySelectorAll('polyline')).toHaveLength(2)
    vi.advanceTimersByTime(500)
    expect(root.querySelectorAll('polyline')).toHaveLength(0)

    trail.destroy()
    expect(root.querySelector('svg')).toBeNull()
  })
})

describe('bindScreenTouch for iOS (Zebrunner)', () => {
  let root: HTMLElement
  let calls: unknown[][]
  let unbind: () => void

  function control(): Control {
    const record = (name: string) => (...args: unknown[]) => {
      calls.push([name, ...args])
    }
    return {
      target: {ios: true}
      , gestureStart: record('gestureStart')
      , gestureStop: record('gestureStop')
      , touchDown: record('touchDown')
      , touchDownIos: record('touchDownIos')
      , touchMove: record('touchMove')
      , touchMoveIos: record('touchMoveIos')
      , touchPathIos: record('touchPathIos')
      , touchUp: record('touchUp')
      , touchCommit: record('touchCommit')
      , touchReset: record('touchReset')
    } as unknown as Control
  }

  function mouse(type: string, x: number, y: number, time: number, target: EventTarget = root) {
    const event = new MouseEvent(type, {bubbles: true, cancelable: true})
    Object.defineProperty(event, 'pageX', {value: x})
    Object.defineProperty(event, 'pageY', {value: y})
    Object.defineProperty(event, 'timeStamp', {value: time})
    target.dispatchEvent(event)
  }

  function names() {
    return calls.map((call) => call[0])
  }

  beforeEach(() => {
    calls = []
    root = document.createElement('div')
    Object.defineProperty(root, 'offsetWidth', {value: 100})
    Object.defineProperty(root, 'offsetHeight', {value: 200})
    document.body.appendChild(root)
    const scaler = {
      coords: (w: number, h: number, x: number, y: number) => ({xP: x / w, yP: y / h})
    } as unknown as ScalingCoordinator
    unbind = bindScreenTouch({
      root
      , input: document.createElement('input')
      , fingers: [document.createElement('span'), document.createElement('span')]
      , screen: {rotation: 0, bounds: {w: 0, h: 0, x: 0, y: 0}}
      , scaler
      , control: control()
    })
  })

  afterEach(() => {
    unbind()
    root.remove()
  })

  it('sends the whole path of a drag before its touchUp', () => {
    mouse('mousedown', 50, 180, 1000)
    mouse('mousemove', 50, 140, 1016)
    mouse('mousemove', 50, 60, 1032)
    mouse('mouseup', 50, 20, 1048, document)

    expect(names()).not.toContain('touchMoveIos')
    const path = calls.find((call) => call[0] === 'touchPathIos')
    expect(path![1]).toEqual([[
      {x: 0.5, y: 0.9, t: 0}
      , {x: 0.5, y: 0.7, t: 16}
      , {x: 0.5, y: 0.3, t: 32}
      , {x: 0.5, y: 0.1, t: 48}
    ]])
    expect(names().indexOf('touchPathIos')).toBeLessThan(names().indexOf('touchUp'))
    expect(root.querySelector('svg.ios-trail polyline')!.getAttribute('points')).toBe('50,180 50,140 50,60 50,20')
  })

  it('keeps a click a tap', () => {
    mouse('mousedown', 50, 100, 1000)
    mouse('mouseup', 50, 100, 1080, document)
    expect(names()).toContain('touchDownIos')
    expect(names()).toContain('touchUp')
    expect(names()).not.toContain('touchPathIos')
  })

  it('pinches with the mirrored finger of Alt', () => {
    const down = new MouseEvent('mousedown', {bubbles: true, cancelable: true, altKey: true})
    Object.defineProperty(down, 'pageX', {value: 40})
    Object.defineProperty(down, 'pageY', {value: 80})
    Object.defineProperty(down, 'timeStamp', {value: 0})
    root.dispatchEvent(down)
    const move = new MouseEvent('mousemove', {bubbles: true, cancelable: true, altKey: true})
    Object.defineProperty(move, 'pageX', {value: 20})
    Object.defineProperty(move, 'pageY', {value: 40})
    Object.defineProperty(move, 'timeStamp', {value: 32})
    root.dispatchEvent(move)
    mouse('mouseup', 20, 40, 48, document)

    expect(calls.filter((call) => call[0] === 'touchDownIos')).toHaveLength(1)
    const contacts = calls.find((call) => call[0] === 'touchPathIos')![1] as Array<Array<{x: number, y: number}>>
    expect(contacts).toHaveLength(2)
    expect(contacts[1]![0]).toMatchObject({x: 0.6, y: 0.6})
    expect(contacts[1]![contacts[1]!.length - 1]).toMatchObject({x: 0.8, y: 0.8})
  })
})
