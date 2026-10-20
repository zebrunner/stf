// Fork (Zebrunner): the go-ios helpers of the ios-device unit, lib/units/ios-device/plugins/util/goios.ts:
// the allow list of the shell of the dashboard and the parsers of `ios syslog` and `ios fsync tree`
import {expect} from 'chai'

import {
  IosNetworkCollector
, afcPath
, connectedByUsb
, isAgentWarning
, ostraceEntry
, parseBattery
, parseDeviceInfo
, parseDiskSpace
, tunnelSupported
, goIosError
, matchesFilters
, parseFsyncTree
, parseSyslog
, shellArgs
, splitCommandLine
} from '../../../lib/units/ios-device/plugins/util/goios.js'

describe('zebrunner: ios-device go-ios command line', function() {
  it('should split words with quotes and escapes', function() {
    expect(splitCommandLine('  launch  com.example.app --arg="a b" --env=\'X=1 2\' c\\ d '))
      .to.deep.equal(['launch', 'com.example.app', '--arg=a b', '--env=X=1 2', 'c d'])
    expect(splitCommandLine('lang --setlocale=""')).to.deep.equal(['lang', '--setlocale='])
    expect(splitCommandLine('')).to.deep.equal([])
  })

  it('should refuse an unterminated quote', function() {
    expect(function() {
      splitCommandLine('launch "com.example')
    }).to.throw('Unterminated quote')
  })

  it('should take the allowed commands with or without "ios" in front', function() {
    expect(shellArgs('apps --list')).to.deep.equal(['apps', '--list'])
    expect(shellArgs('ios apps --list')).to.deep.equal(['apps', '--list'])
    expect(shellArgs('info --pretty')).to.deep.equal(['info', '--pretty'])
    expect(shellArgs('crash ls')).to.deep.equal(['crash', 'ls'])
    expect(shellArgs('fsync tree --app=com.example.app --path=/Documents'))
      .to.deep.equal(['fsync', 'tree', '--app=com.example.app', '--path=/Documents'])
    expect(shellArgs('setlocation --lat=-33.86 --lon=151.2'))
      .to.deep.equal(['setlocation', '--lat=-33.86', '--lon=151.2'])
    expect(shellArgs('voiceover get')).to.deep.equal(['voiceover', 'get'])
    expect(shellArgs('launch com.example.app --kill-existing'))
      .to.deep.equal(['launch', 'com.example.app', '--kill-existing'])
  })

  it('should refuse the commands outside of the allow list', function() {
    ['erase --force', 'pair', 'tunnel start', 'runwda', 'install --path=/tmp/a.ipa', 'forward 1 2']
      .forEach(function(command) {
        expect(function() {
          shellArgs(command)
        }, command).to.throw(/is not allowed/)
      })
    expect(function() {
      shellArgs('   ')
    }).to.throw(/Enter a go-ios command/)
  })

  it('should allow only the listed subcommands', function() {
    expect(function() {
      shellArgs('crash cp * /tmp')
    }).to.throw('Only "crash ls" of "crash" is allowed')
    expect(function() {
      shellArgs('fsync pull --srcPath=/DCIM --dstPath=/tmp')
    }).to.throw('Only "fsync tree" of "fsync" is allowed')
    expect(function() {
      shellArgs('fsync rm --path=/DCIM')
    }).to.throw('Only "fsync tree" of "fsync" is allowed')
    expect(function() {
      shellArgs('devmode enable')
    }).to.throw('Only "devmode get" of "devmode" is allowed')
  })

  it('should refuse another device, tunnels, credentials and files of the container', function() {
    [
      'info --udid=other'
    , 'info --UDID=other'
    , 'info --udi=other'
    , 'info --ud other'
    , 'info --address=fd00::1'
    , 'info --rsd-port=1'
    , 'info --tunnel-info-port=1'
    , 'info --proxyurl=http://proxy'
    , 'info -t'
    , 'info -vt'
    , 'info --trace'
    , 'info --'
    , 'profile list --p12file=a.p12'
    , 'apps --li'
    ].forEach(function(command) {
      expect(function() {
        shellArgs(command)
      }, command).to.throw(/^The option ".*" is not allowed$/)
    })
  })

  // docopt takes the value of an option from the next word, which then is not the subcommand
  it('should not let an option hide the subcommand that runs', function() {
    [
      'fsync --driver tree rm --r --path=/DCIM'
    , 'crash --driver ls cp * /tmp/x'
    , 'profile --dri list remove foo'
    , 'devmode --wda-url get enable'
    , 'devicestate --driver list enable a b'
    , 'fsync --app=com.example.app rm --path=/'
    ].forEach(function(command) {
      expect(function() {
        shellArgs(command)
      }, command).to.throw(/^Only ".*" is allowed$/)
    })
    expect(function() {
      shellArgs('fsync tree --path /DCIM')
    }).to.throw('Write the value of "--path" as --path=<value>')
    expect(function() {
      shellArgs('apps --list=yes')
    }).to.throw('The option "--list" takes no value')
    expect(function() {
      shellArgs('fsync tree --r --path=/')
    }).to.throw('The option "--r" is not allowed')
  })

  it('should read the last error go-ios logged', function() {
    expect(goIosError([
      '{"level":"info","msg":"connecting"}'
    , '{"level":"error","msg":"fsync: tree view failed","err":"permission denied"}'
    , ''
    ].join('\n'))).to.equal('fsync: tree view failed: permission denied')
    expect(goIosError('panic: boom\n')).to.equal('panic: boom')
    expect(goIosError('{"level":"info","msg":"ok"}')).to.equal('')
  })
})

describe('zebrunner: ios-device syslog', function() {
  it('should parse the JSON lines of ios syslog as logcat entries', function() {
    expect(parseSyslog(JSON.stringify({
      msg: 'Oct 19 17:02:46 iPhone SpringBoard(FrontBoard)[57] <Notice>: Scene became active'
    }))).to.deep.equal({
      pid: 57
    , priority: 4
    , tag: 'SpringBoard(FrontBoard)'
    , message: 'Scene became active'
    })
    expect(parseSyslog(JSON.stringify({
      msg: 'Oct  9 07:02:46 iPhone kernel[0] <Error>: first line\nsecond line'
    }))).to.deep.equal({
      pid: 0
    , priority: 6
    , tag: 'kernel'
    , message: 'first line\nsecond line'
    })
  })

  it('should map the levels of syslog to the priorities of logcat', function() {
    function priority(level: string) {
      return parseSyslog('Oct 19 17:02:46 iPhone app[1] <' + level + '>: m')!.priority
    }
    expect(priority('Debug')).to.equal(3)
    expect(priority('Info')).to.equal(4)
    expect(priority('Notice')).to.equal(4)
    expect(priority('Warning')).to.equal(5)
    expect(priority('Error')).to.equal(6)
    expect(priority('Critical')).to.equal(7)
    expect(priority('Unknown')).to.equal(4)
  })

  it('should keep a line it cannot parse as the message and drop empty ones', function() {
    expect(parseSyslog('{"msg":"--- last message repeated 1 time ---"}')).to.deep.equal({
      pid: 0
    , priority: 4
    , tag: ''
    , message: '--- last message repeated 1 time ---'
    })
    expect(parseSyslog('{"msg":""}')).to.equal(null)
    expect(parseSyslog('{"level":"info"}')).to.equal(null)
    expect(parseSyslog('')).to.equal(null)
  })

  it('should filter the entries the way logcat does', function() {
    var entry = {pid: 1, priority: 5, tag: 'SpringBoard', message: 'm'}
    expect(matchesFilters(entry, [])).to.equal(true)
    expect(matchesFilters(entry, [{tag: '*', priority: 5}])).to.equal(true)
    expect(matchesFilters(entry, [{tag: '*', priority: 6}])).to.equal(false)
    expect(matchesFilters(entry, [{tag: 'kernel', priority: 2}])).to.equal(false)
    expect(matchesFilters(entry, [
      {tag: 'kernel', priority: 2}
    , {tag: 'SpringBoard', priority: 3}
    ])).to.equal(true)
  })
})

describe('zebrunner: ios-device AFC', function() {
  it('should take the first level of the tree as the entries of the directory', function() {
    expect(parseFsyncTree([
      '|-Books/'
    , '|-DCIM/'
    , '|  |-100APPLE/'
    , '|  |  |-IMG_0001.JPG'
    , '|  |-.MISC/'
    , '|-Downloads/'
    , '|-name with |- and spaces.txt'
    , ''
    ].join('\n'))).to.deep.equal([
      {name: 'Books', mode: 0o040000, size: -1}
    , {name: 'DCIM', mode: 0o040000, size: -1}
    , {name: 'Downloads', mode: 0o040000, size: -1}
    , {name: 'name with |- and spaces.txt', mode: 0o100000, size: -1}
    ])
  })

  it('should take the entries of a subdirectory, deeper in the tree', function() {
    expect(parseFsyncTree([
      '|  |-100APPLE/'
    , '|  |  |-IMG_0001.JPG'
    , '|  |-IMG_0002.HEIC'
    ].join('\n'))).to.deep.equal([
      {name: '100APPLE', mode: 0o040000, size: -1}
    , {name: 'IMG_0002.HEIC', mode: 0o100000, size: -1}
    ])
    expect(parseFsyncTree('')).to.deep.equal([])
  })

  it('should normalize the paths and refuse to leave the media directory', function() {
    expect(afcPath('/')).to.equal('/')
    expect(afcPath('')).to.equal('/')
    expect(afcPath('DCIM//100APPLE/./')).to.equal('/DCIM/100APPLE')
    expect(function() {
      afcPath('/DCIM/../../etc')
    }).to.throw(/is not allowed/)
  })
})

describe('zebrunner: ios-device connection', function() {
  it('should tell a device connected by USB from one over the network', function() {
    var list = JSON.stringify({deviceList: [
      {Udid: 'usb-1', ConnectionType: 'USB'}
    , {Udid: 'net-1', ConnectionType: 'Network'}
    ]})
    expect(connectedByUsb(list, 'usb-1')).to.equal(true)
    expect(connectedByUsb(list, 'net-1')).to.equal(false)
    expect(connectedByUsb(list, 'other')).to.equal(false)
    expect(connectedByUsb('', 'usb-1')).to.equal(false)
  })
})

// The outputs of go-ios 1.3.2 on an iPhone XR with iOS 18.7.10, shortened
var INFO = JSON.stringify({
  BuildVersion: '22H374'
, CPUArchitecture: 'arm64e'
, CarrierBundleInfoArray: []
, HardwarePlatform: 't8020'
, InternationalMobileEquipmentIdentity: '357366097804847'
, ProductType: 'iPhone11,8'
, ProductVersion: '18.7.10'
, SerialNumber: 'F71XNBGXKXK7'
})

describe('zebrunner: ios-device info', function() {
  it('should read the fields of the Info tab from lockdown', function() {
    expect(parseDeviceInfo(INFO)).to.deep.equal({
      manufacturer: 'Apple'
    , product: 'iPhone11,8'
    , version: '18.7.10'
    , sdk: '22H374'
    , abi: 'arm64e'
    , cpuPlatform: 't8020'
    , operator: null
    , phone: {imei: '357366097804847', imsi: null, phoneNumber: null, iccid: null}
    })
  })

  it('should read the SIM of a device with one', function() {
    var info = parseDeviceInfo(JSON.stringify({
      PhoneNumber: '+48 600 000 000'
    , CarrierBundleInfoArray: [{
        CFBundleIdentifier: 'com.apple.Orange_PL'
      , IntegratedCircuitCardIdentity: '8948'
      , InternationalMobileSubscriberIdentity: '26003'
      }]
    }))!
    expect(info.operator).to.equal('Orange PL')
    expect(info.phone).to.deep.equal({
      imei: null
    , imsi: '26003'
    , phoneNumber: '+48 600 000 000'
    , iccid: '8948'
    })
  })

  it('should read the last JSON go-ios printed', function() {
    expect(parseDeviceInfo('not json')).to.equal(null)
    expect(parseDiskSpace('{"Model":"iPhone11,8","TotalBytes":63944380416,"FreeBytes":1}'))
      .to.equal(60982)
    expect(parseDiskSpace('{}')).to.equal(null)
  })

  it('should read the battery from its IORegistry', function() {
    expect(parseBattery(JSON.stringify({
      Temperature: 2050
    , Voltage: 4184
    , IsCharging: false
    , CurrentCapacity: 100
    , DesignCapacity: 2942
    , NominalChargeCapacity: 2769
    }))).to.deep.equal({health: 'good', status: 'full', level: 100, temp: '20.5', voltage: 4.184})
    expect(parseBattery(JSON.stringify({
      IsCharging: true
    , CurrentCapacity: 41
    , DesignCapacity: 2942
    , NominalChargeCapacity: 2000
    }))).to.deep.equal({health: 'dead', status: 'charging', level: 41, temp: '', voltage: null})
    expect(parseBattery(JSON.stringify({CurrentCapacity: 41})))
      .to.include({status: 'discharging', health: 'good'})
    expect(parseBattery('{}')).to.equal(null)
  })

  it('should tell the warning about the agent of go-ios', function() {
    expect(isAgentWarning(JSON.stringify({
      time: '2026-10-19T18:53:51Z'
    , level: 'WARN'
    , msg: 'go-ios agent is not running. You might need to start it with \'ios tunnel start\''
    }))).to.equal(true)
    expect(isAgentWarning('{"level":"WARN","msg":"failed to get tunnel info"}')).to.equal(false)
  })
})

// Lines of `ios ostrace` on an iPhone XR with iOS 18.7.10, shortened
function trace(process: string, message: string): string {
  return JSON.stringify({pid: 50, filename: '/usr/sbin/' + process, message: message})
}

var WIFI_LINK = trace('wifid', '__WiFiLQAMgrLogStats(SOLVD_DEMO:Stationary): ' +
  'InfraUptime:2235.8secs Channel: 36 Bandwidth: 40Mhz Rssi: -32 {-30 0} Cca: 83 (S:0 O:0 I:0) ' +
  'Snr: 29 BcnPer: 0.0% (22)')
var WIFI_RELAY = trace('symptomsd', 'StateRelay for type 3: WiFi (active/primary/constrained-no/' +
  'expensive-no/rssifull/arp-ok/dns-ok/lqm:100/advisory:7/pwrDL:1/pwrUL:1/ic:1/loi:home)')

function collect(lines: string[]) {
  var collector = new IosNetworkCollector()
  lines.forEach(function(line) {
    var entry = ostraceEntry(line)
    if (entry) {
      collector.add(entry)
    }
  })
  return collector
}

describe('zebrunner: ios-device network', function() {
  it('should read the Wi-Fi link and the primary interface from the system log', function() {
    var collector = collect([trace('wifid', 'Apple80211GetIfListCopy: enter'), WIFI_LINK])
    expect(collector.complete()).to.equal(false)
    collector.add(ostraceEntry(WIFI_RELAY)!)
    expect(collector.complete()).to.equal(true)
    expect(collector.network()).to.deep.equal({
      connected: true
    , type: 'WIFI'
    , wifi: {ssid: 'SOLVD_DEMO', channel: 36, bandwidth: 40, rssi: -32, snr: 29}
    })
  })

  it('should keep an SSID with colons and parentheses', function() {
    var line = trace('wifid', '__WiFiLQAMgrLogStats(Cafe: 2 (guest):Moving): InfraUptime:5.0secs ' +
      'Channel: 6 Bandwidth: 20Mhz Rssi: -71')
    expect(collect([line]).network().wifi).to.deep.equal({
      ssid: 'Cafe: 2 (guest)', channel: 6, bandwidth: 20, rssi: -71, snr: null
    })
  })

  it('should tell no network with Wi-Fi off and no other interface', function() {
    expect(collect([trace('wifid', 'nothing'), 'not json']).network())
      .to.deep.equal({connected: false, type: null, wifi: null})
  })

  it('should take the cellular network when it is the primary interface', function() {
    var network = collect([
      trace('symptomsd', 'StateRelay for type 3: WiFi (inactive/constrained-no)')
    , trace('symptomsd', 'StateRelay for type 1: Cell (active/primary/expensive-yes)')
    ]).network()
    expect(network).to.deep.equal({connected: true, type: 'MOBILE', wifi: null})
  })

  it('should read only the lines of ostrace', function() {
    expect(ostraceEntry(WIFI_LINK)!.process).to.equal('wifid')
    expect(ostraceEntry('{"level":"WARN","msg":"go-ios agent is not running"}')).to.equal(null)
    expect(ostraceEntry('plain text')).to.equal(null)
  })
})

describe('zebrunner: device data of an iOS device', function() {
  it('should keep the capacity the device tells over the one of its model', async function() {
    var datautil = (await import('../../../lib/util/datautil.js')).default
    var device = datautil.applyData({
      serial: 'udid'
    , model: 'iPhone_XR'
    , memory: {rom: 60982}
    } as unknown as Parameters<typeof datautil.applyData>[0]) as unknown as {
      name: string
      cpu: {name: string}
      memory: {ram: number, rom: number}
    }
    expect(device.name).to.equal('iPhone XR')
    expect(device.cpu.name).to.equal('Apple A12')
    expect(device.memory).to.deep.equal({ram: 3072, rom: 60982})
  })
})

describe('zebrunner: hardware of iOS models', function() {
  it('should know every model by its ProductType', async function() {
    var models = (await import('../../../lib/util/zebrunner-ios-models.json', {
      with: {type: 'json'}
    })).default as Record<string, {name: string, display: object, cpu: object}>
    var keys = Object.keys(models)
    expect(keys.length).to.be.above(100)
    keys.forEach(function(key) {
      expect(key, key).to.match(/^(iPhone|iPad)\d+,\d+$/)
      expect(models[key]!.name, key).to.be.a('string')
      expect(models[key]!.display, key).to.include.keys('inches', 'ppi', 'fps', 'width', 'height')
      expect(models[key]!.cpu, key).to.include.keys('name', 'cores', 'freq')
    })
  })

  it('should put the hardware of the model on an iOS device', async function() {
    var datautil = (await import('../../../lib/util/datautil.js')).default
    var device = datautil.applyData({
      serial: 'udid'
    , ios: true
    , model: 'iPhone_XR'
    , product: 'iPhone11,8'
    , memory: {rom: 60982}
    , display: {width: 828, height: 1792, scale: 2}
    } as unknown as Parameters<typeof datautil.applyData>[0]) as unknown as Record<string, any>
    expect(device.name).to.equal('iPhone XR')
    expect(device.releasedAt).to.equal('2018-10-26T00:00:00.000Z')
    expect(device.cpu).to.deep.equal({name: 'Apple A12 Bionic', cores: 6, freq: 2.49})
    expect(device.memory).to.deep.equal({ram: 3072, rom: 60982})
    expect(device.display).to.deep.equal({
      width: 828, height: 1792, scale: 2, density: 2, inches: 6.1, fps: 60, xdpi: 326, ydpi: 326
    })
  })

  it('should leave a model it does not know and the Android devices as they are', async function() {
    var {applyIosModel} = await import('../../../lib/util/zebrunner-ios-models.js')
    expect(applyIosModel({ios: true, product: 'iPhone99,1', name: 'x'})).to.deep.equal({
      ios: true, product: 'iPhone99,1', name: 'x'
    })
    expect(applyIosModel({product: 'iPhone11,8'})).to.deep.equal({product: 'iPhone11,8'})
  })
})

describe('zebrunner: ios-device tunnel', function() {
  it('should run the userspace tunnel from iOS 17.4 on', function() {
    function info(version: string) {
      return JSON.stringify({ProductVersion: version, DeviceClass: 'iPhone'})
    }
    expect(tunnelSupported(info('18.7.10'))).to.equal(true)
    expect(tunnelSupported(info('26.0'))).to.equal(true)
    expect(tunnelSupported(info('17.4'))).to.equal(true)
    expect(tunnelSupported(info('17.3.1'))).to.equal(false)
    expect(tunnelSupported(info('16.7.10'))).to.equal(false)
    expect(tunnelSupported('{}')).to.equal(false)
    expect(tunnelSupported('')).to.equal(false)
  })
})
