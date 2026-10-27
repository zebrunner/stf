/**
* Fork (Zebrunner): the CURVE keys of the ZeroMQ security, see lib/util/zmqcurve.ts
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'curve-keygen'

var describe = 'Print a new CURVE key pair of the ZeroMQ security (STF_ZMQ_CURVE_*).'

var builder = function(yargs: Argv) {
  return yargs
    .strict()
    .option('secret-key', {
      describe: 'Print the pair of this secret key (64 hex characters) instead of a new one.'
    , type: 'string'
    })
    .epilog('Prints `public=<key>` and `secret=<key>`, the keys are 64 hex characters. ' +
      'The secret key of a server goes to STF_ZMQ_CURVE_SERVER_SECRET_KEY, its public key to ' +
      'STF_ZMQ_CURVE_SERVER_PUBLIC_KEY of the clients; the secret key of a client goes to ' +
      'STF_ZMQ_CURVE_SECRET_KEY, its public key to STF_ZMQ_CURVE_CLIENT_KEYS of the server.')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  var zmqcurve: typeof import('../../util/zmqcurve.js') = require('../../util/zmqcurve.js')
  try {
    var pair = zmqcurve.generateKeyPair(argv.secretKey)
    process.stdout.write(`public=${pair.publicKey}\nsecret=${pair.secretKey}\n`)
  }
  catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exitCode = 1
  }
}

export {command, describe, builder, handler}
