// Fork (Zebrunner): the go-ios helpers of the ios-device unit, lib/units/ios-device/plugins/util/goios.ts:
// the allow list of the shell of the dashboard and the parsers of `ios syslog` and `ios fsync tree`
import {expect} from 'chai'

import {
  afcPath
, connectedByUsb
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
