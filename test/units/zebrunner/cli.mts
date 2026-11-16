// Fork (Zebrunner): the options the fork adds to the CLI and the ones the Zebrunner deployment
// (mcloud, mcloud-device) relies on
import {expect} from 'chai'
import yargs, {type Argv} from 'yargs'

import * as api from '../../../lib/cli/api/index.js'
import * as authZebrunner from '../../../lib/cli/auth-zebrunner/index.js'
import * as iosDevice from '../../../lib/cli/ios-device/index.js'
import * as local from '../../../lib/cli/local/index.js'
import * as provider from '../../../lib/cli/provider/index.js'
import * as storageS3 from '../../../lib/cli/storage-s3/index.js'
import * as storageTemp from '../../../lib/cli/storage-temp/index.js'
import {mockModule} from '../../helpers/module-mock.mts'

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

    it('should take the fixed connect port of STF_PROVIDER_CONNECT_PORT', function() {
      expect(parse(provider, providerArgs)).to.not.have.property('connectPort')
      expect(parse(provider, providerArgs, {STF_PROVIDER_CONNECT_PORT: '7405'}).connectPort)
        .to.equal(7405)
      expect(parse(provider, providerArgs.concat(['--connect-port', '5555'])).connectPort)
        .to.equal(5555)
    })

    it('should refuse an invalid connect port or a pool without the ports of a device',
      function() {
        expect(function() {
          parse(provider, providerArgs, {STF_PROVIDER_CONNECT_PORT: '70000'})
        }).to.throw('Invalid --connect-port "70000", expected a port of 1..65535')
        expect(function() {
          parse(provider, providerArgs, {STF_PROVIDER_CONNECT_PORT: 'adb'})
        }).to.throw(/Invalid --connect-port/)
        expect(function() {
          parse(provider, providerArgs.concat(['--min-port', '7404', '--max-port', '7407']), {
            STF_PROVIDER_CONNECT_PORT: '7405'
          })
        }).to.throw('--min-port 7404..--max-port 7407 needs 4 ports besides --connect-port 7405')
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

  describe('api', function() {
    var apiArgs = [
      '--connect-push', 'tcp://app:7170', '--connect-sub', 'tcp://app:7150'
    , '--connect-push-dev', 'tcp://dev:7270', '--connect-sub-dev', 'tcp://dev:7250'
    ]

    it('should take the settings of the enrollment of the nodes', function() {
      var argv = parse(api, apiArgs.concat([
        '--nodes-connect-sub', 'tcp://10.0.0.1:7250'
      , '--nodes-connect-push', 'tcp://10.0.0.1:7270'
      ]), {
        SECRET: 'secret'
      , STF_URL: 'https://mcloud.example.com'
      , STF_API_NODES_CONNECT_APP_DEALER: 'tcp://10.0.0.1:7160'
      , STF_API_NODES_CONNECT_DEV_DEALER: 'tcp://10.0.0.1:7260'
      })
      expect(argv).to.include({
        nodesStfUrl: 'https://mcloud.example.com'
      , nodesConnectSub: 'tcp://10.0.0.1:7250'
      , nodesConnectPush: 'tcp://10.0.0.1:7270'
      , nodesConnectAppDealer: 'tcp://10.0.0.1:7160'
      , nodesConnectDevDealer: 'tcp://10.0.0.1:7260'
      })
    })

    it('should give the API unit the settings of the nodes', function() {
      var argv = parse(api, apiArgs.concat(['--nodes-stf-url', 'https://stf']), {SECRET: 'secret'})
      var options: Record<string, any> = {}
      var restore = mockModule(new URL('../../../lib/units/api/index.js', import.meta.url), {
        default: function(unitOptions: Record<string, unknown>) {
          options = unitOptions
        }
      })
      var saved = process.env.STF_STORAGE_TOKEN
      process.env.STF_STORAGE_TOKEN = 'internal'
      try {
        api.handler(argv as Parameters<typeof api.handler>[0])
      }
      finally {
        restore()
        if (typeof saved === 'undefined') {
          delete process.env.STF_STORAGE_TOKEN
        }
        else {
          process.env.STF_STORAGE_TOKEN = saved
        }
      }
      expect(options.nodes.stfUrl).to.equal('https://stf')
      expect(options.nodes).to.not.have.property('agentHosts')
      expect(options.nodes.internalToken).to.equal('internal')
    })
  })

  describe('local', function() {
    it('should start the Zebrunner auth unit', function() {
      expect(parse(local, ['--auth-type', 'zebrunner']).authType).to.equal('zebrunner')
    })
  })

  describe('ios-device', function() {
    // the options entrypoint.sh of mcloud-device passes
    var iosArgs = [
      '--serial', 'udid'
    , '--screen-port', '7400'
    , '--connect-port', '20002'
    , '--provider', 'provider'
    , '--public-ip', 'mcloud.example.com'
    , '--storage-url', 'http://stf/'
    , '--connect-push', 'tcp://dev:7270'
    , '--connect-sub', 'tcp://dev:7250'
    , '--connect-app-dealer', 'tcp://app:7160'
    , '--connect-dev-dealer', 'tcp://dev:7260'
    , '--wda-host', 'connector'
    , '--wda-port', '20001'
    ]

    // unitOptions <args>: the options the handler gives the ios-device unit; the handler requires
    // the unit, so the first mock stays in the require cache and sets this variable
    var options: Record<string, any> = {}
    function unitOptions(args: string[]) {
      var argv = parse(iosDevice, args)
      var restore = mockModule(new URL('../../../lib/units/ios-device/index.js', import.meta.url), {
        default: function(given: Record<string, unknown>) {
          options = given
        }
      })
      options = {}
      try {
        iosDevice.handler(argv as Parameters<typeof iosDevice.handler>[0])
      }
      finally {
        restore()
      }
      return options
    }

    it('should be listed in the help of stf', function() {
      expect(iosDevice.describe).to.be.a('string').and.not.equal('')
    })

    it('should read the MJPEG stream of --connect-port without --mjpeg-port', function() {
      var options = unitOptions(iosArgs)
      expect(options.connectPort).to.equal(20002)
      expect(options).to.have.property('mjpegPort').that.is.not.a('number')
      expect(options.wdaHost).to.equal('connector')
    })

    it('should give the unit --mjpeg-port', function() {
      expect(unitOptions(iosArgs.concat(['--mjpeg-port', '20003'])).mjpegPort).to.equal(20003)
    })

    it('should default to WDA on the local host', function() {
      expect(parse(iosDevice, iosArgs.slice(0, -4)).wdaHost).to.equal('127.0.0.1')
    })

    it('should refuse the options it does not use', function() {
      expect(function() {
        parse(iosDevice, iosArgs.concat(['--iproxy']))
      }).to.throw(/Unknown argument/)
      expect(function() {
        parse(iosDevice, iosArgs.concat(['--udid-storage', '/tmp/udids']))
      }).to.throw(/Unknown argument/)
    })
  })
})
