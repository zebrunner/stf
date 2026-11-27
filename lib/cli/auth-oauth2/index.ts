import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'auth-oauth2'

var describe = 'Start an OAuth 2.0 auth unit.'

var builder = function(yargs: Argv) {
  return yargs
    .env('STF_AUTH_OAUTH2')
    .strict()
    .option('app-url', {
      alias: 'a'
    , describe: 'URL to the app unit.'
    , type: 'string'
    , demand: true
    })
    .option('oauth-authorization-url', {
      describe: 'OAuth 2.0 authorization URL.'
    , type: 'string'
    , default: process.env.OAUTH_AUTHORIZATION_URL
    , demand: true
    })
    .option('oauth-token-url', {
      describe: 'OAuth 2.0 token URL.'
    , type: 'string'
    , default: process.env.OAUTH_TOKEN_URL
    , demand: true
    })
    .option('oauth-userinfo-url', {
      describe: 'OAuth 2.0 user info URL.'
    , type: 'string'
    , default: process.env.OAUTH_USERINFO_URL
    , demand: true
    })
    .option('oauth-client-id', {
      describe: 'OAuth 2.0 client ID.'
    , type: 'string'
    , default: process.env.OAUTH_CLIENT_ID
    , demand: true
    })
    .option('oauth-client-secret', {
      describe: 'OAuth 2.0 client secret.'
    , type: 'string'
    , default: process.env.OAUTH_CLIENT_SECRET
    , demand: true
    })
    .option('oauth-callback-url', {
      describe: 'OAuth 2.0 callback URL.'
    , type: 'string'
    , default: process.env.OAUTH_CALLBACK_URL
    , demand: true
    })
    .option('oauth-scope', {
      describe: 'Space-separated OAuth 2.0 scope.'
    , type: 'string'
    , default: process.env.OAUTH_SCOPE
    , demand: true
    })
    // Fork (Zebrunner): on by default, kept in a cookie of the sign-in (upstream off, and it needed a
    // session store the unit did not have); --no-oauth-state turns it off
    .option('oauth-state', {
      describe: 'Whether to send and check the OAuth 2.0 state parameter (login CSRF).'
    , type: 'boolean'
    , default: process.env.OAUTH_STATE ? process.env.OAUTH_STATE !== 'false' : true
    , defaultDescription: 'true, or OAUTH_STATE of the environment'
    })
    .option('oauth-domain', {
      describe: 'Email domain of the users (recommended: without it every account of the ' +
        'provider with a verified email signs in).'
    , type: 'string'
    , default: process.env.OAUTH_DOMAIN
    , demand: false
    })
    // Fork (Zebrunner): for a provider that never sends email_verified (ZEBRUNNER.md#oauth2-sign-in)
    .option('oauth-allow-missing-email-verified', {
      describe: 'Take a profile without email_verified (a provider that never sends it); a ' +
        'profile with email_verified false is refused anyway.'
    , type: 'boolean'
    , default: process.env.OAUTH_ALLOW_MISSING_EMAIL_VERIFIED === 'true'
    , defaultDescription: 'false, or OAUTH_ALLOW_MISSING_EMAIL_VERIFIED of the environment'
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7120
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
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_AUTH_OAUTH2_` (e.g. ' +
      '`STF_AUTH_OAUTH2_SECRET`). Legacy environment variables like ' +
      'OAUTH_SCOPE are still accepted, too, but consider them ' +
      'deprecated.')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/auth/oauth2/index.js').default({
    port: argv.port
  , secret: argv.secret
  , ssid: argv.ssid
  , appUrl: argv.appUrl
  , domain: argv.oauthDomain
  , allowMissingEmailVerified: argv.oauthAllowMissingEmailVerified
  , oauth: {
      authorizationURL: argv.oauthAuthorizationUrl
    , tokenURL: argv.oauthTokenUrl
    , userinfoURL: argv.oauthUserinfoUrl
    , clientID: argv.oauthClientId
    , clientSecret: argv.oauthClientSecret
    , callbackURL: argv.oauthCallbackUrl
    , scope: argv.oauthScope.split(/\s+/)
    , state: argv.oauthState
    }
  })
}

export {command, describe, builder, handler}
