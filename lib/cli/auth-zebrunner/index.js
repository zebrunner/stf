module.exports.command = 'auth-zebrunner'
module.exports.describe = 'Start a Zebrunner auth unit.'

module.exports.builder = function(yargs) {
  return yargs
    .env('STF_AUTH_ZEBRUNNER')
    .strict()
    .option('app-url', {
      alias: 'a'
    , describe: 'URL to the app unit.'
    , type: 'string'
    , demand: true
    })
    .option('zebrunner-login-url', {
      alias: 'l'
      , describe: 'Zebrunner authorization URL.'
      , type: 'string'
      , default: process.env.ZEBRUNNER_LOGIN_URL
      , demand: true
    })
    .option('zebrunner-userinfo-url', {
      alias: 'u'
      , describe: 'Zebrunner user info URL.'
      , type: 'string'
      , default: process.env.ZEBRUNNER_USERINFO_URL

      , demand: true
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
      'underscores and prefixing it with `STF_AUTH_ZEBRUNNER_` (e.g. ' +
      '`STF_AUTH_ZEBRUNNER_AUTHORIZATION_URL`).')
}

module.exports.handler = function(argv) {
  return require('../../units/auth/zebrunner')({
    port: argv.port
    , secret: argv.secret
    , ssid: argv.ssid
    , appUrl: argv.appUrl
    , zebrunner: {
      loginURL: argv.zebrunnerLoginUrl
      , userinfoURL: argv.zebrunnerUserinfoUrl
    }
  })
}
