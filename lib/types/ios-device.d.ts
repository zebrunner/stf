import type {ChildProcess} from 'child_process'
import type {EventEmitter} from 'events'
import type {Readable} from 'stream'
import type Bluebird from 'bluebird'
import type FormData from 'form-data'
import type deviceData from '@devicefarmer/stf-device-db'
import type zmqutil from '../util/zmqutil.js'
import type wirerouter from '../wire/router.js'
import type ChannelManager from '../wire/channelmanager.js'
import type {DeviceDocument, InstalledAppEntry} from './stf.js'
import type {
  BrowserOpenMessageFields
, OwnerMessage
, TapDeviceTreeElementFields
, TouchDownIosMessageFields
, TouchMoveIosMessageFields
} from './wire.js'

export interface IosDeviceOptions {
  serial: string
  provider: string
  publicIp: string
  endpoints: {
    sub: string[]
    push: string[]
    appDealer: string[]
    devDealer: string[]
  }
  groupTimeout: number
  storageUrl: string
  adbHost: string
  adbPort: number
  screenJpegQuality: number
  screenPingInterval: number
  screenPort: number
  screenWsUrlPattern: string
  connectUrlPattern: string
  connectPort: number
  wdaHost: string
  wdaPort: number
  mjpegPort: number
  vncInitialSize: number[]
  heartbeatInterval: number
  bootCompleteTimeout: number
  muteMaster: 'always' | 'inuse' | 'never'
  lockRotation: boolean | undefined
  cleanup: boolean
  screenReset: boolean
  udidStorage: string | false
  iproxy: boolean
  deviceName: string
  host: string
}

export type ZmqSocket = ReturnType<typeof zmqutil.socket>
export type Push = ZmqSocket
export type Sub = ZmqSocket
export type Router = ReturnType<typeof wirerouter>
export type Channels = ChannelManager
export type DeviceData = NonNullable<ReturnType<typeof deviceData.find>>
export type DeviceFlags = NonNullable<DeviceData['flags']>

export interface IosScreenOptions {
  devicePort: number
  publicPort: number
  publicUrl: string
}

export interface IosInfoPlugin {
  manageDeviceInfo(): Bluebird<void>
}

export interface IosSoloPlugin {
  channel: string
  poke(): void
}

export interface IosGroupEvents {
  join: [group: OwnerMessage]
  leave: [group: OwnerMessage]
  autojoin: [identifier: string, joined: boolean]
}

export interface IosGroupPlugin extends EventEmitter {
  get(): Bluebird<OwnerMessage>
  join(
    newGroup: OwnerMessage
  , timeout?: number | null
  , usage?: string | null
  ): Bluebird<OwnerMessage>
  keepalive(): void
  leave(reason: string): Bluebird<OwnerMessage>
  on(event: 'join', listener: (group: OwnerMessage) => void): this
  on(event: 'leave', listener: (group: OwnerMessage) => void): this
  on(event: 'autojoin', listener: (identifier: string, joined: boolean) => void): this
  emit(event: 'join', group: OwnerMessage): boolean
  emit(event: 'leave', group: OwnerMessage): boolean
  emit(event: 'autojoin', identifier: string, joined: boolean): boolean
}

export interface IosNotifierPlugin {
  setDeviceTemporaryUnavailable(err: unknown): void
  setDeviceAbsent(err: unknown): void
}

export interface IosStorageMeta extends FormData.AppendOptions {}

export interface IosStoredFile {
  href: string
  [key: string]: unknown
}

export interface IosStoragePlugin {
  store(type: string, stream: Readable, meta: IosStorageMeta): Bluebird<IosStoredFile>
}

export type IosOrientation =
  'PORTRAIT'
| 'LANDSCAPE'
| 'UIA_DEVICE_ORIENTATION_PORTRAIT_UPSIDEDOWN'
| 'UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT'

export interface IosDeviceSize {
  width: number
  height: number
}

export interface IosSwipeResult {
  fromX: number
  fromY: number
  toX: number
  toY: number
  duration: number
}

export interface IosPressButtonContext {
  deviceType: string | null
  appActivate(bundleId: string): Bluebird<unknown> | unknown
  pressButton(name: string): Bluebird<unknown> | unknown
  pressPower(): Bluebird<unknown> | unknown
  homeBtn(): Bluebird<unknown> | unknown
  switchCharset(): void
}

export interface RpOptions {
  method?: string
  uri?: string
  url?: string
  body?: unknown
  json?: boolean
  headers?: Record<string, string>
}

export interface RpRequestError extends Error {
  cause?: unknown
  error?: unknown
  options?: RpOptions
}

export interface RpStatusCodeError extends Error {
  statusCode: number
  error: unknown
  options: RpOptions
  response: unknown
}

export interface WdaValueResponse<T> {
  value: T
  sessionId?: string
}

export interface WdaSessionCapabilities {
  device: string
  sdkVersion: string
  CFBundleIdentifier?: string
  browserName?: string
}

export type WdaSessionResponse = WdaValueResponse<{capabilities: WdaSessionCapabilities}> & {
  sessionId: string
}

export interface WdaStatusResponse {
  sessionId?: string
  value?: unknown
}

export interface WdaBatteryInfo {
  state: number
  level: number
}

export interface WdaWindowSize {
  width: number
  height: number
}

export interface WdaScreenInfo {
  scale: number
}

export interface WdaElementValue {
  ELEMENT?: string
  'element-6066-11e4-a52e-4f735466cecf'?: string
}

export interface WdaErrorBody {
  value?: {
    message?: string
  }
}

export interface WdaClientPlugin {
  baseUrl: string
  sessionId: string | null
  deviceSize: IosDeviceSize | null
  orientation: IosOrientation | null
  touchDownParams: Partial<TouchDownIosMessageFields>
  tapStartAt: number
  typeKeyActions: Array<{type: 'keyDown' | 'keyUp', value: string}>
  typeKeyTimerId: NodeJS.Timeout | null
  typeKeyDelay: number
  upperCase: boolean
  isSwiping: boolean
  isRotating: boolean
  deviceType: string | null
  getDeviceType(): string | null | Bluebird<string | null | undefined> | void
  startSession(): Bluebird<unknown>
  stopSession(): Bluebird<unknown>
  setStatus(status: number): void
  typeKey(params: {value: Array<string | null>}): void
  tap(params: TouchDownIosMessageFields): void
  homeBtn(): Bluebird<unknown>
  swipe(params: TouchMoveIosMessageFields): void
  touchUp(): Bluebird<unknown> | void
  tapDeviceTreeElement(message: TapDeviceTreeElementFields): Bluebird<unknown>
  doubleClick(): Bluebird<unknown> | void
  size(): IosDeviceSize | Bluebird<IosDeviceSize | null | void>
  setVersion(currentSession: WdaSessionResponse): void
  openUrl(message: BrowserOpenMessageFields): Bluebird<unknown>
  screenshot(): Bluebird<WdaValueResponse<string>>
  getOrientation(): Bluebird<void>
  rotation(params: {orientation: IosOrientation}): Bluebird<void>
  batteryIosEvent(): Bluebird<void>
  getTreeElements(): Bluebird<unknown>
  pressButton(params: string): Bluebird<unknown>
  switchCharset(): void
  appActivate(params: string): Bluebird<unknown>
  pressPower(): Bluebird<unknown>
  getClipBoard(): Bluebird<string>
  handleRequest<T = unknown>(requestOpt: RpOptions): Bluebird<T>
}

export interface DeviceLoggerPlugin {
  appOptions: Record<string, unknown>
  channel: string
  stream: ChildProcess | null
  setChannel(channel: string): void
  startLoggging(channel: string, deviceData?: InstalledAppEntry): void
  killLoggingProcess(): void
}

export interface DisplayProperties {
  id: number
  width: number
  height: number
  xdpi: number
  ydpi: number
  fps: number
  density: number
  rotation: number
  secure: boolean
  size: number
  url?: string
}

export interface IosDisplay extends EventEmitter {
  id: number
  properties: DisplayProperties
  updateRotation(newRotation: number): void
}

export type PhoneProperties = Record<string, string>

export interface IosIdentity {
  serial: string
  display?: DisplayProperties
  phone?: PhoneProperties
  [key: string]: unknown
}

export interface Flags {
  has(flag: keyof DeviceFlags): boolean | null | undefined
  get<K extends keyof DeviceFlags, D>(flag: K, defaultValue: D): DeviceFlags[K] | D
}

export type DisplayDocument = NonNullable<DeviceDocument['display']>

export interface WebSocketWithAlive {
  isAlive?: boolean
  close(): void
  send(data: string): void
  on(event: 'close' | 'error', listener: () => void): this
}
