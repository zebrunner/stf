/**
* Fork (Zebrunner): enrolls a node directly in the database, without an invite, for `stf local`,
* the tests and a development setup (ZEBRUNNER.md#nodes-enrollment). A deployment enrolls its nodes
* with invites (POST /api/v1/nodes/invites, POST /api/v1/nodes/enroll).
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'node-add'

var describe = 'Enroll a node in the database without an invite (development, tests).'

var builder = function(yargs: Argv) {
  return yargs
    .strict()
    .option('label', {
      describe: 'The label of the node.'
    , type: 'string'
    , demand: true
    })
    .option('address', {
      describe: 'The address of the node, its STF_PROVIDER_HOST (a loopback address is accepted).'
    , type: 'string'
    , demand: true
    })
    .option('public-key', {
      describe: 'The CURVE public key of the node (64 hex characters), a random one by default ' +
        '(a setup without CURVE).'
    , type: 'string'
    })
    .epilog('The token of the node is STF_NODE_TOKEN when it is set (mcn1.<label>.<secret>), ' +
      'else a new one, printed as `token=<token>`. A node of the label is re-enrolled.')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  var crypto: typeof import('crypto') = require('crypto')
  var logger = require('../../util/logger.js').default
  var log = logger.createLogger('cli:node-add')
  var zebrunnerNodes: typeof import('../../util/zebrunner-nodes.js') =
    require('../../util/zebrunner-nodes.js')
  var nodes = zebrunnerNodes.default

  function fail(message: string): void {
    log.fatal(message)
    process.exit(1)
  }

  var label = argv.label
  var address = nodes.normalizeAddress(argv.address, {loopback: true})
  var publicKey = (argv.publicKey || crypto.randomBytes(32).toString('hex')).toLowerCase()
  if (!nodes.isLabel(label)) {
    return fail(`Invalid label "${label}"`)
  }
  if (!address) {
    return fail(`Invalid address "${argv.address}"`)
  }
  if (!zebrunnerNodes.PUBLIC_KEY.test(publicKey)) {
    return fail('The public key must be 64 hex characters')
  }
  var token = process.env.STF_NODE_TOKEN || ''
  var generated = !token
  if (generated) {
    token = nodes.generateNodeToken(label)
  }
  else if (nodes.tokenLabel(token) !== label) {
    return fail(`STF_NODE_TOKEN is not a node token of the label "${label}"`)
  }

  var dbapi: typeof import('../../db/api.js').default = require('../../db/api.js').default
  return Promise.all([dbapi.loadNodeByAddress(address), dbapi.loadNodeByPublicKey(publicKey)])
    .then(function([addressNode, keyNode]) {
      if (addressNode && addressNode.label !== label) {
        return fail(`"${address}" is the address of the node "${addressNode.label}"`)
      }
      if (keyNode && keyNode.label !== label) {
        return fail(`The key is the key of the node "${keyNode.label}"`)
      }
      return dbapi.enrollNode({
        label: label
      , address: address!
      , publicKey: publicKey
      , tokenHash: nodes.sha256(token)
      })
        .then(function(node) {
          log.important(
            'Node "%s" at "%s" enrolled (generation %d)'
          , node.label
          , node.address
          , node.generation
          )
          // the output of a pipe is written before the exit
          process.stdout.write(generated ? `token=${token}\n` : '', function() {
            process.exit(0)
          })
        })
    })
    .catch(function(err: Error) {
      fail(`Unable to enroll the node: ${err.message}`)
    })
}

export {command, describe, builder, handler}
