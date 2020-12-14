module.exports.command = 'ios-device'

module.exports.builder = function(yargs) {
  return yargs
    .strict()
    .option('adb-host', {
      describe: 'The ADB server host.'
      , type: 'string'
      , default: '127.0.0.1'
    })
    .option('adb-port', {
      describe: 'The ADB server port.'
      , type: 'number'
      , default: 5037
    })
    .option('boot-complete-timeout', {
      describe: 'How long to wait for boot to complete during device setup.'
      , type: 'number'
      , default: 60000
    })
    .option('cleanup', {
      describe: 'Attempt to reset the device between uses by uninstalling' +
      'apps, resetting accounts and clearing caches. Does not do a perfect ' +
      'job currently. Negate with --no-cleanup.'
      , type: 'boolean'
      , default: true
    })
    .option('connect-port', {
      describe: 'Port allocated to adb connections.'
      , type: 'number'
      , demand: true
    })
    .option('connect-push', {
      alias: 'p'
      , describe: 'ZeroMQ PULL endpoint to connect to.'
      , array: true
      , demand: true
    })
    .option('connect-sub', {
      alias: 's'
      , describe: 'ZeroMQ PUB endpoint to connect to.'
      , array: true
      , demand: true
    })
    .option('connect-url-pattern', {
      describe: 'The URL pattern to use for `adb connect`.'
      , type: 'string'
      , default: '${publicIp}:${publicPort}'
    })
    .option('group-timeout', {
      alias: 't'
      , describe: 'Timeout in seconds for automatic release of inactive devices.'
      , type: 'number'
      , default: 900
    })
    .option('heartbeat-interval', {
      describe: 'Send interval in milliseconds for heartbeat messages.'
      , type: 'number'
      , default: 10000
    })
    .option('lock-rotation', {
      describe: 'Whether to lock rotation when devices are being used. ' +
      'Otherwise changing device orientation may not always work due to ' +
      'sensitive sensors quickly or immediately reverting it back to the ' +
      'physical orientation.'
      , type: 'boolean'
    })
    .option('mute-master', {
      describe: 'Whether to mute master volume.'
      , choices: ['always', 'inuse', 'never']
      , default: 'never'
      , coerce: val => {
        if (val === true) {
          return 'inuse' // For backwards compatibility.
        }

        if (val === false) {
          return 'never' // For backwards compatibility.
        }

        return val
      }
    })
    .option('provider', {
      alias: 'n'
      , describe: 'Name of the provider.'
      , type: 'string'
      , demand: true
    })
    .option('public-ip', {
      describe: 'The IP or hostname to use in URLs.'
      , type: 'string'
      , demand: true
    })
    .option('screen-jpeg-quality', {
      describe: 'The JPG quality to use for the screen.'
      , type: 'number'
      , default: process.env.SCREEN_JPEG_QUALITY || 80
    })
    .option('screen-ping-interval', {
      describe: 'The interval at which to send ping messages to keep the ' +
      'screen WebSocket alive.'
      , type: 'number'
      , default: 30000
    })
    .option('screen-port', {
      describe: 'Port allocated to the screen WebSocket.'
      , type: 'number'
      , demand: true
    })
    .option('screen-reset', {
      describe: 'Go back to home screen and reset screen rotation ' +
      'when user releases device. Negate with --no-screen-reset.'
      , type: 'boolean'
      , default: true
    })
    .option('screen-ws-url-pattern', {
      describe: 'The URL pattern to use for the screen WebSocket.'
      , type: 'string'
      , default: 'ws://${publicIp}:${publicPort}'
    })
    .option('serial', {
      describe: 'The USB serial number of the device.'
      , type: 'string'
      , demand: true
    })
    .option('storage-url', {
      alias: 'r'
      , describe: 'The URL to the storage unit.'
      , type: 'string'
      , demand: true
    })
    .option('vnc-initial-size', {
      describe: 'The initial size to use for the experimental VNC server.'
      , type: 'string'
      , default: '600x800'
      , coerce: function(val) {
        return val.split('x').map(Number)
      }
    })
    .option('connect-app-dealer', {
      describe: 'App-side ZeroMQ DEALER endpoint to connect to.'
      , array: true
      , demand: true
    })
    .option('connect-dev-dealer', {
      describe: 'Device-side ZeroMQ DEALER endpoint to connect to.'
      , array: true
      , demand: true
    })
    .option('wda-host', {
        describe: 'iOS device host ip address where WDA is started.'
      , type: 'string'
      , default: '192.168.88.78'
    })
    .option('wda-port', {
        describe: 'The port the WDA should run et.'
      , type: 'number'
      , default: 20001
    })
    .option('mjpeg-port', {
        describe: 'The port the WDA mjpeg is started.'
      , type: 'number'
      , default: 20002
    })
    .option('udid-storage', {
      describe: 'The path for ip information of devoces'
    , type: 'string'
    , default: false
  })
  .option('iproxy', {
      describe: 'If the option with iproxy is passed, use proxy connection with devices'
    , type: 'boolean'
    , default: false
  })
    .option('appium-host', {
      describe: 'Appium hostname.'
    , type: 'string'
    , demand: true
    , default: '127.0.0.1'
    })
  .option('appium-port', {
      describe: 'The appium\'s port for remote debug'
    , type: 'number'
    , default: 4723
  })
  .option('proxy-appium-port', {
      describe: 'Port allocated to Appium proxy'
    , type: 'number'
    , default: null
  })
  .option('device-name', {
    describe: 'Device name'
    , type: 'string'
    , default: false
  })
  .option('device-type', {
    describe: 'Device type'
    , type: 'string'
    , default: false
  })
}

module.exports.handler = function(argv) {
  return require('../../units/ios-device')({
    serial: argv.serial
    , provider: argv.provider
    , publicIp: argv.publicIp
    , endpoints: {
      sub: argv.connectSub
      , push: argv.connectPush
      , appDealer: argv.connectAppDealer
      , devDealer: argv.connectDevDealer
    }
    , groupTimeout: argv.groupTimeout * 1000 // change to ms
    , storageUrl: argv.storageUrl
    , adbHost: argv.adbHost
    , adbPort: argv.adbPort
    , screenJpegQuality: argv.screenJpegQuality
    , screenPingInterval: argv.screenPingInterval
    , screenPort: argv.screenPort
    , screenWsUrlPattern: argv.screenWsUrlPattern
    , connectUrlPattern: argv.connectUrlPattern
    , connectPort: argv.connectPort
    , wdaHost: argv.wdaHost
    , wdaPort: argv.wdaPort
    , vncInitialSize: argv.vncInitialSize
    , heartbeatInterval: argv.heartbeatInterval
    , bootCompleteTimeout: argv.bootCompleteTimeout
    , muteMaster: argv.muteMaster
    , lockRotation: argv.lockRotation
    , cleanup: argv.cleanup
    , screenReset: argv.screenReset
    , udidStorage: argv.udidStorage
    , iproxy: argv.iproxy
    , appiumHost: argv.appiumHost
    , appiumPort: argv.appiumPort
    , proxyAppiumPort: argv.proxyAppiumPort
    , deviceName: argv.deviceName
    , deviceType: argv.deviceType
  })
}
