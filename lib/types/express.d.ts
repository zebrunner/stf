import events from 'events'
import zmq from 'zeromq/v5-compat.js'
import type {NodesOptions} from './units-api.js'

declare global {
  namespace Express {
    interface ApiRequestOptions {
      push: zmq.Socket
      sub: zmq.Socket
      pushdev: zmq.Socket
      subdev: zmq.Socket
      channelRouter: events.EventEmitter
      secret: string
      // Fork (Zebrunner)
      nodes?: NodesOptions
    }

    interface Request {
      options?: ApiRequestOptions
    }

    interface User {
      email?: string
    }
  }
}
