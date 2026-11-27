import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'websocket'

var describe = 'Start a websocket unit.'

var builder = function(yargs: Argv) {
  return yargs
    .env('STF_WEBSOCKET')
    .strict()
    .option('connect-push', {
      alias: 'c'
    , describe: 'App-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub', {
      alias: 'u'
    , describe: 'App-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7110
    })
    .option('secret', {
      alias: 's'
    , describe: 'The secret to use for auth JSON Web Tokens. Anyone who ' +
        'knows this token can freely enter the system if they want, so keep ' +
        'it safe.'
    , type: 'string'
    , default: process.env.SECRET
    , demand: true
    })
    .option('ssid', {
      alias: 'i'
    , describe: 'The name of the session ID cookie.'
    , type: 'string'
    , default: process.env.SSID || 'ssid'
    })
    .option('storage-url', {
      alias: 'r'
    , describe: 'URL to the storage unit.'
    , type: 'string'
    , demand: true
    })
    // Fork (Zebrunner): ZEBRUNNER.md#websocket-origin
    .option('allowed-origin', {
      describe: 'An origin (or URL) of the pages of the UI that may open the WebSocket, ' +
        'besides the one of --storage-url and the host of the request. A browser of another ' +
        'origin is refused.'
    , type: 'string'
    , array: true
    , default: []
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_WEBSOCKET_` (e.g. ' +
      '`STF_WEBSOCKET_STORAGE_URL`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/websocket/index.js').default({
    port: argv.port
  , secret: argv.secret
  , ssid: argv.ssid
  , storageUrl: argv.storageUrl
  , allowedOrigins: argv.allowedOrigin
  , endpoints: {
      sub: argv.connectSub
    , push: argv.connectPush
    }
  })
}

export {command, describe, builder, handler}
