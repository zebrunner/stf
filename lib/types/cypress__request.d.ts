declare module '@cypress/request' {
  import http from 'http'
  import stream from 'stream'
  import FormData from 'form-data'

  namespace request {
    interface Options {
      url: string
      json?: boolean
      body?: unknown
      // Fork (Zebrunner): storage credentials, see lib/util/storageauth.ts
      headers?: Record<string, string>
    }

    // Fork (Zebrunner): the request options of lib/util/urlsafety.ts
    interface CoreOptions {
      headers?: Record<string, string>
      lookup?: unknown
      followRedirect?: boolean | ((response: Response) => boolean)
      maxRedirects?: number
    }

    type Response = http.IncomingMessage & {request: {uri: URL}}

    interface TextOptions extends Options {
      json?: false
    }

    type Callback = (error: Error | null, response: http.IncomingMessage, body: string) => void

    class Request extends stream.Stream {
      pipe<T extends NodeJS.WritableStream>(destination: T, options?: {end?: boolean}): T
      form(): FormData
      on(event: 'response', listener: (response: http.IncomingMessage) => void): this
      on(event: 'error', listener: (error: Error) => void): this
      on(event: string | symbol, listener: (...args: any[]) => void): this
    }

    function get(uri: string | TextOptions, callback?: Callback): Request
    function post(uri: string | TextOptions, callback?: Callback): Request
  }

  function request(uri: string | request.TextOptions, callback?: request.Callback): request.Request
  function request(uri: string, options?: request.CoreOptions): request.Request

  export = request
}
