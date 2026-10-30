// Fork (Zebrunner): the options the fork adds to the CLI and the ones the Zebrunner deployment
// (mcloud, mcloud-device) relies on
import {expect} from 'chai'
import yargs, {type Argv} from 'yargs'

import * as authZebrunner from '../../../lib/cli/auth-zebrunner/index.js'
import * as local from '../../../lib/cli/local/index.js'
import * as provider from '../../../lib/cli/provider/index.js'
import * as storageS3 from '../../../lib/cli/storage-s3/index.js'
import * as storageTemp from '../../../lib/cli/storage-temp/index.js'

interface Command {
  builder(yargs: Argv): Argv
}

// parse <command> <args> <env>: the options the builder of the command parses, with only these
// environment variables of STF set
function parse(command: Command, args: string[], env: Record<string, string> = {}) {
  // yargs keeps the process.env object it saw first, so it is changed in place
  var saved: Record<string, string | undefined> = {}
  Object.keys(process.env).concat(Object.keys(env)).forEach(function(name) {
    if (/^(STF_|SECRET$|SSID$|ZEBRUNNER_)/.test(name) && !(name in saved)) {
      saved[name] = process.env[name]
      delete process.env[name]
    }
  })
  Object.assign(process.env, env)
  try {
    return command.builder(yargs(args))
      .exitProcess(false)
      .fail(function(message, err) {
        throw err || new Error(message)
      })
      .parseSync() as Record<string, unknown>
  }
  finally {
    Object.keys(saved).forEach(function(name) {
      if (typeof saved[name] === 'undefined') {
        delete process.env[name]
      }
      else {
        process.env[name] = saved[name]
      }
    })
  }
}

var providerArgs = [
  '--connect-push', 'tcp://dev:7270'
, '--connect-sub', 'tcp://dev:7250'
, '--storage-url', 'http://stf/'
]

var storageEnv = {SECRET: 'secret', STF_STORAGE_TOKEN: 'token'}

describe('zebrunner: CLI', function() {
  describe('provider', function() {
    it('should take the variables the device containers set', function() {
      var argv = parse(provider, providerArgs, {
        STF_PROVIDER_HOST: 'agent-host'
      , STF_PROVIDER_DEVICE_NAME: 'Pixel 8'
      , STF_PROVIDER_VNC_PORT: '5901'
      })
      expect(argv.host).to.equal('agent-host')
      expect(argv.deviceName).to.equal('Pixel 8')
      expect(argv.vncPort).to.equal(5901)
    })

    it('should keep the defaults of a single device container', function() {
      var argv = parse(provider, providerArgs)
      expect(argv.vncPort).to.equal(5900)
      expect(argv.host).to.equal('127.0.0.1')
    })

    it('should refuse a variable it does not declare', function() {
      expect(function() {
        parse(provider, providerArgs, {STF_PROVIDER_SOMETHING_ELSE: 'x'})
      }).to.throw(/Unknown argument/)
    })
  })

  describe('storage-temp', function() {
    it('should start without a storage token, as upstream', function() {
      var argv = parse(storageTemp, [])
      expect(typeof argv.storageToken).to.equal('undefined')
    })

    it('should require the secret with a storage token', function() {
      expect(function() {
        parse(storageTemp, [], {STF_STORAGE_TOKEN: 'token'})
      }).to.throw(/needs --secret/)
    })

    it('should take them from SECRET and STF_STORAGE_TOKEN', function() {
      var argv = parse(storageTemp, [], storageEnv)
      expect(argv.secret).to.equal('secret')
      expect(argv.storageToken).to.equal('token')
      expect(argv.ssid).to.equal('ssid')
      expect(argv.downloadAllow).to.eql([])
    })

    it('should accept the networks downloads may come from', function() {
      var argv = parse(storageTemp, [
        '--download-allow', '10.1.0.0/16'
      , '--download-allow', '192.168.7.7'
      ], storageEnv)
      expect(argv.downloadAllow).to.eql(['10.1.0.0/16', '192.168.7.7'])
    })

    it('should take the options of mcloud and no ZeroMQ endpoints', function() {
      var argv = parse(storageTemp, ['--port', '3000', '--save-dir', '/data'], storageEnv)
      expect(argv.port).to.equal(3000)
      expect(argv.saveDir).to.equal('/data')
      expect(function() {
        parse(storageTemp, ['--connect-sub', 'tcp://stf-triproxy-app:7150'], storageEnv)
      }).to.throw(/Unknown argument/)
    })
  })

  describe('storage-s3', function() {
    var s3Args = ['--bucket', 'b', '--endpoint', 'http://s3', '--profile', 'p']

    it('should require the secret with a storage token', function() {
      expect(function() {
        parse(storageS3, s3Args, {STF_STORAGE_TOKEN: 'token'})
      }).to.throw(/needs --secret/)
      expect(parse(storageS3, s3Args, storageEnv).storageToken).to.equal('token')
    })
  })

  describe('auth-zebrunner', function() {
    it('should take the Zebrunner URLs from the variables of mcloud', function() {
      var argv = parse(authZebrunner, ['--app-url', 'http://stf/'], {
        SECRET: 'secret'
      , ZEBRUNNER_LOGIN_URL: 'http://zebrunner/api/iam/v1/auth/login'
      , ZEBRUNNER_USERINFO_URL: 'http://zebrunner/api/iam/v1/users'
      })
      expect(argv.zebrunnerLoginUrl).to.equal('http://zebrunner/api/iam/v1/auth/login')
      expect(argv.zebrunnerUserinfoUrl).to.equal('http://zebrunner/api/iam/v1/users')
    })

    it('should require the Zebrunner URLs', function() {
      expect(function() {
        parse(authZebrunner, ['--app-url', 'http://stf/'], {SECRET: 'secret'})
      }).to.throw(/zebrunner-login-url|zebrunner-userinfo-url/)
    })
  })

  describe('local', function() {
    it('should start the Zebrunner auth unit', function() {
      expect(parse(local, ['--auth-type', 'zebrunner']).authType).to.equal('zebrunner')
    })
  })
})
