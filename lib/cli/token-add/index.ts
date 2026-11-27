/**
* Fork (Zebrunner): creates an access token of a user directly in the database, without a sign-in:
* `./zebrunner.sh start` of mcloud makes the access token of the admin (STF_TOKEN) with it after
* `stf migrate`, also with the OAuth2 and LDAP sign-ins (ZEBRUNNER.md#access-token-of-the-admin).
**/

import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'token-add'

var describe = 'Create an access token of a user (the admin by default) in the database, print it.'

var builder = function(yargs: Argv) {
  return yargs
    .strict()
    .option('email', {
      describe: 'The email of the user, an existing one (`stf migrate` creates the admin).'
    , type: 'string'
    , default: process.env.STF_ADMIN_EMAIL
    , defaultDescription: 'STF_ADMIN_EMAIL of the environment'
    , demand: true
    })
    .option('title', {
      describe: 'The title of the token (Settings, Keys); an earlier token of the user with ' +
        'this title is removed.'
    , type: 'string'
    , default: 'mcloud'
    })
    .option('secret', {
      alias: 's'
    , describe: 'Unused: the database keeps the hash of the token (accepted for the scripts ' +
        'that pass it).'
    , type: 'string'
    , default: process.env.SECRET
    // the value of the secret is not shown by --help
    , defaultDescription: 'SECRET of the environment'
    })
    .option('ttl', {
      describe: 'The lifetime of the token in seconds; none by default (the token does not expire).'
    , type: 'number'
    })
    .epilog('Prints the token as `token=<token>`.')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  var logger = require('../../util/logger.js').default
  var log = logger.createLogger('cli:token-add')
  var accessTokens: typeof import('../../util/zebrunner-access-tokens.js').default =
    require('../../util/zebrunner-access-tokens.js').default

  function fail(message: string): void {
    log.fatal(message)
    process.exit(1)
  }

  var email = argv.email
  var title = argv.title
  if (!email) {
    return fail('The email of the user is required (--email or STF_ADMIN_EMAIL)')
  }
  if (!title) {
    return fail('The title is required')
  }
  var invalid = accessTokens.ttlError(argv.ttl)
  if (invalid) {
    return fail(`The token is not created: ${invalid}`)
  }

  var dbapi: typeof import('../../db/api.js').default = require('../../db/api.js').default
  return dbapi.loadUser(email)
    .then(function(user) {
      if (!user) {
        return fail(`No user "${email}": run stf migrate first, it creates the admin`)
      }
      // a token of the API: 64 hex characters, as the ones of POST /api/v1/user/accessTokens; the database
      // keeps its hash (ZEBRUNNER.md#access-tokens)
      var id = accessTokens.newSecret()
      return dbapi.removeUserAccessToken(user.email, title)
        .then(function() {
          return dbapi.saveUserAccessToken(user.email, {
            secret: id
          , title: title
          , expiresAt: accessTokens.expiryOf(argv.ttl)
          })
        })
        .then(function() {
          log.important('Access token "%s" of "%s" created', title, user.email)
          // the output of a pipe is written before the exit
          process.stdout.write(`token=${id}\n`, function() {
            process.exit(0)
          })
        })
    })
    .catch(function(err: Error) {
      fail(`Unable to create the access token: ${err.message}`)
    })
}

export {command, describe, builder, handler}
