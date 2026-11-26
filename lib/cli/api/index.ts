/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'api'

var describe = 'Start an API unit.'

// Fork (Zebrunner): the --nodes-wg-* options of the WireGuard tunnel of the nodes
function wireguardOptions(argv: Record<string, unknown>) {
  function value(name: string) {
    return typeof argv[name] === 'string' ? argv[name] as string : null
  }
  return {
    endpoint: value('nodesWgEndpoint')
  , publicKey: value('nodesWgPublicKey')
  , serverAddress: value('nodesWgServerAddress')
  , network: value('nodesWgNetwork')
  }
}

var builder = function(yargs: Argv) {
  return yargs
    .env('STF_API')
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
    .option('connect-push-dev', {
      alias: 'pd'
    , describe: 'Device-side ZeroMQ PULL endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('connect-sub-dev', {
      alias: 'sd'
    , describe: 'Device-side ZeroMQ PUB endpoint to connect to.'
    , array: true
    , demand: true
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7106
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
    // Fork (Zebrunner): what the enrollment of a node returns, lib/units/api/controllers/zebrunner-nodes.ts
    .option('nodes-stf-url', {
      describe: 'The public URL of STF the enrolled nodes use (STF_URL by default).'
    , type: 'string'
    , default: process.env.STF_URL
    })
    .option('nodes-connect-sub', {
      describe: 'The ZeroMQ PUB endpoint of the device side the enrolled nodes connect to.'
    , type: 'string'
    })
    .option('nodes-connect-push', {
      describe: 'The ZeroMQ PULL endpoint of the device side the enrolled nodes connect to.'
    , type: 'string'
    })
    .option('nodes-connect-app-dealer', {
      describe: 'The ZeroMQ DEALER endpoint of the app side the enrolled nodes connect to.'
    , type: 'string'
    })
    .option('nodes-connect-dev-dealer', {
      describe: 'The ZeroMQ DEALER endpoint of the device side the enrolled nodes connect to.'
    , type: 'string'
    })
    // Fork (Zebrunner): the opt-in WireGuard tunnel of the nodes, all of them or none (off)
    .option('nodes-wg-endpoint', {
      describe: 'The public UDP endpoint (host:port) of the WireGuard tunnel of the nodes.'
    , type: 'string'
    })
    .option('nodes-wg-public-key', {
      describe: 'The WireGuard public key of the head.'
    , type: 'string'
    })
    .option('nodes-wg-server-address', {
      describe: 'The WireGuard address (IPv4) of the head.'
    , type: 'string'
    })
    .option('nodes-wg-network', {
      describe: 'The network (IPv4 CIDR) of the WireGuard tunnel: the addresses of the nodes are ' +
        'in it.'
    , type: 'string'
    })
    .check(function(argv) {
      var zebrunnerNodes: typeof import('../../util/zebrunner-nodes.js') =
        require('../../util/zebrunner-nodes.js')
      var error = zebrunnerNodes.wireguardSettings(wireguardOptions(argv)).error
      if (error) {
        throw new Error(`Invalid options: ${error}`)
      }
      return true
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_API_` (e.g. ' +
      '`STF_API_PORT`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/api/index.js').default({
    port: argv.port
  , ssid: argv.ssid
  , secret: argv.secret
  , endpoints: {
      push: argv.connectPush
    , sub: argv.connectSub
    , pushdev: argv.connectPushDev
    , subdev: argv.connectSubDev
    }
    // Fork (Zebrunner): the enrolled device hosts, lib/units/api/controllers/zebrunner-nodes.ts
  , nodes: {
      stfUrl: argv.nodesStfUrl
    , endpoints: {
        sub: argv.nodesConnectSub
      , push: argv.nodesConnectPush
      , appDealer: argv.nodesConnectAppDealer
      , devDealer: argv.nodesConnectDevDealer
      }
    , serverPublicKey: process.env.STF_ZMQ_CURVE_SERVER_PUBLIC_KEY
    , internalToken: process.env.STF_STORAGE_TOKEN
    , wireguard: wireguardOptions(argv)
    }
  })
}

export {command, describe, builder, handler}
