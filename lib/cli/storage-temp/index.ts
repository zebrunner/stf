import {createRequire} from 'module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'

var require = createRequire(import.meta.url)

var command = 'storage-temp'

var describe = 'Start a temp storage unit.'

var builder = function(yargs: Argv) {
  var os = require('os')

  return yargs
    .env('STF_STORAGE_TEMP')
    .strict()
    .option('max-file-size', {
      describe: 'Maximum file size to allow for uploads. Note that nginx ' +
        'may have a separate limit, meaning you should change both.'
    , type: 'number'
    , default: 1 * 1024 * 1024 * 1024
    })
    .option('port', {
      alias: 'p'
    , describe: 'The port to bind to.'
    , type: 'number'
    , default: process.env.PORT || 7100
    })
    // Fork (Zebrunner): authentication of the storage routes and SSRF protection, see
    // lib/util/storageauth.ts and lib/util/urlsafety.ts
    .option('secret', {
      describe: 'The secret of the session cookies of the app unit, the same as its --secret.'
    , type: 'string'
    , default: process.env.SECRET
    })
    .option('storage-token', {
      describe: 'The token the STF units send to the storage (STF_STORAGE_TOKEN of the device ' +
        'containers). With it the routes need the token or a session and downloads are limited ' +
        'to public addresses; without it they stay open as in upstream.'
    , type: 'string'
    , default: process.env.STF_STORAGE_TOKEN
    })
    .check(function(argv) {
      return !argv.storageToken || Boolean(argv.secret) ||
        'The storage token needs --secret (SECRET)'
    })
    .option('ssid', {
      describe: 'The name of the session cookie of the app unit.'
    , type: 'string'
    , default: process.env.SSID || 'ssid'
    })
    .option('download-allow', {
      describe: 'Private networks (CIDR or address) users may download files from, ' +
        'e.g. an internal artifact server. Public addresses are always allowed.'
    , array: true
    , type: 'string'
    , default: []
    })
    .option('save-dir', {
      describe: 'The location where files are saved to.'
    , type: 'string'
    , default: os.tmpdir()
    })
    .option('bundletool-path', {
      describe: 'The path to bundletool binary.'
    , type: 'string'
    , default: '/app/bundletool/bundletool.jar'
    })
    .option('ks', {
      describe: 'The name of the keystore to sign APKs built from AAB.'
    , type: 'string'
    , default: 'openstf'
    })
    .option('ks-key-alias', {
      describe: 'Indicates the alias to be used in the future to refer to the keystore.'
    , type: 'string'
    , default: 'mykey'
    })
    .option('ks-pass', {
      describe: 'The password of the keystore.'
    , type: 'string'
    , default: 'openstf'
    })
    .option('ks-key-pass', {
      describe: 'The password of the private key contained in keystore.'
    , type: 'string'
    , default: 'openstf'
    })
    .option('ks-keyalg', {
      describe: 'The algorithm that is used to generate the key.'
    , type: 'string'
    , default: 'RSA'
    })
    .option('ks-validity', {
      describe: 'Number of days of keystore validity.'
    , type: 'number'
    , default: '90'
    })
    .option('ks-keysize', {
      describe: 'Key size of the keystore.'
    , type: 'number'
    , default: '2048'
    })
    .option('ks-dname', {
      describe: 'Keystore Distinguished Name, contain Common Name(CN), ' +
        'Organizational Unit (OU), Oranization(O), Locality (L), State (S) and Country (C).'
    , type: 'string'
    , default: 'CN=openstf.io, OU=openstf, O=openstf, L=PaloAlto, S=California, C=US'
    })
    .epilog('Each option can be be overwritten with an environment variable ' +
      'by converting the option to uppercase, replacing dashes with ' +
      'underscores and prefixing it with `STF_STORAGE_TEMP_` (e.g. ' +
      '`STF_STORAGE_TEMP_SAVE_DIR`).')
}

var handler = function(argv: CommandArgv<typeof builder>) {
  return require('../../units/storage/temp.js').default({
    port: argv.port
  , saveDir: argv.saveDir
  , maxFileSize: argv.maxFileSize
  , bundletoolPath: argv.bundletoolPath
  , secret: argv.secret
  , storageToken: argv.storageToken
  , ssid: argv.ssid
  , downloadAllow: argv.downloadAllow
  , keystore: {
      ksPath: `/tmp/${argv.ks}.keystore`
    , ksKeyAlias: argv.ksKeyAlias
    , ksPass: argv.ksPass
    , ksKeyPass: argv.ksKeyPass
    , ksKeyalg: argv.ksKeyalg
    , ksValidity: argv.ksValidity
    , ksKeysize: argv.ksKeysize
    , ksDname: argv.ksDname
    }
  })
}

export {command, describe, builder, handler}
