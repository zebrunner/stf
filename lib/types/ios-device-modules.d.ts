declare module 'mjpeg-consumer' {
  import {Transform} from 'stream'
  export default class MjpegConsumer extends Transform {}
}

declare module 'websocket-stream' {
  import type {Duplex} from 'stream'
  interface WebsocketDuplex extends Duplex {
    socket: {
      on(event: 'error', listener: (err: Error) => void): void
    }
  }

  function websocketStream(socket: unknown): WebsocketDuplex
  export = websocketStream
}
