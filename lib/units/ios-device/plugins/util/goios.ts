import {execFile, spawn, type ChildProcessWithoutNullStreams} from 'child_process'

import Promise from 'bluebird'

// The go-ios binary, installed by the mcloud-device image; it reaches the device through
// USBMUXD_SOCKET_ADDRESS, so only the lockdown services work (no tunnel of iOS 17+)
export var GO_IOS_BIN = 'ios'

// The commands of the shell of the device dashboard (go-ios v1.3.2). A command maps to the
// subcommands it allows, which must follow it, null allows any arguments. Nothing that pairs,
// erases, signs, tunnels, starts WDA or writes files of the container is allowed
var SHELL_COMMANDS: Record<string, string[] | null> = {
  apps: null
, assistivetouch: ['enable', 'disable', 'toggle', 'get']
, batterycheck: null
, batteryregistry: null
, crash: ['ls']
, date: null
, devicename: null
, devicestate: ['list']
, devmode: ['get']
, diagnostics: ['list']
, diskspace: null
, fsync: ['tree']
, image: ['list']
, info: null
, ip: null
, kill: null
, lang: null
, launch: null
, lockdown: ['get']
, mobilegestalt: null
, pasteboard: ['set', 'get']
, profile: ['list']
, ps: null
, reboot: null
, resetlocation: null
, setlocation: null
, timeformat: ['24h', '12h', 'toggle', 'get']
, uninstall: null
, version: null
, voiceover: ['enable', 'disable', 'toggle', 'get']
, zoom: ['enable', 'disable', 'toggle', 'get']
}

// The options of the allowed commands, nothing else: docopt of go-ios takes a prefix of a long
// option (--udi for --udid) and the value of an option from the next word (--driver tree rm would
// run rm), so an option must be one of these, written out, with its value after "="
var SHELL_FLAGS = [
  '--all'
, '--apps'
, '--filesharing'
, '--force'
, '--kill-existing'
, '--list'
, '--nojson'
, '--plist'
, '--pretty'
, '--system'
, '--verbose'
, '--wait'
, '-v'
]

var SHELL_VALUE_OPTIONS = [
  '--app'
, '--arg'
, '--domain'
, '--env'
, '--lat'
, '--lon'
, '--path'
, '--pid'
, '--process'
, '--setlang'
, '--setlocale'
]

export var SHELL_COMMAND_NAMES = Object.keys(SHELL_COMMANDS)

export class GoIosCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoIosCommandError'
  }
}

// splitCommandLine <line>: the words of a command line, with '' and "" quoting and \ escapes
export function splitCommandLine(line: string): string[] {
  var words: string[] = []
  var word = ''
  var inWord = false
  var quote: string | null = null

  for (var i = 0; i < line.length; i++) {
    var char = line[i]!
    if (quote) {
      if (char === quote) {
        quote = null
      }
      else if (char === '\\' && quote === '"' && i + 1 < line.length) {
        word += line[++i]
      }
      else {
        word += char
      }
    }
    else if (char === '"' || char === '\'') {
      quote = char
      inWord = true
    }
    else if (char === '\\' && i + 1 < line.length) {
      word += line[++i]
      inWord = true
    }
    else if (/\s/.test(char)) {
      if (inWord) {
        words.push(word)
        word = ''
        inWord = false
      }
    }
    else {
      word += char
      inWord = true
    }
  }

  if (quote) {
    throw new GoIosCommandError('Unterminated quote')
  }
  if (inWord) {
    words.push(word)
  }
  return words
}

// optionError <arg>: why an option is not allowed, null when it is
function optionError(arg: string): string | null {
  var equals = arg.indexOf('=')
  var name = equals === -1 ? arg : arg.slice(0, equals)
  if (SHELL_FLAGS.includes(name)) {
    return equals === -1 ? null : 'The option "' + name + '" takes no value'
  }
  if (SHELL_VALUE_OPTIONS.includes(name)) {
    return equals === -1 ? 'Write the value of "' + name + '" as ' + name + '=<value>' : null
  }
  return 'The option "' + name + '" is not allowed'
}

// shellArgs <line>: the go-ios arguments of a command of the shell ("ios" in front is optional),
// throws GoIosCommandError when the command is not allowed
export function shellArgs(line: string): string[] {
  var args = splitCommandLine(line)
  if (args[0] === GO_IOS_BIN) {
    args.shift()
  }

  var command = args[0]
  if (!command) {
    throw new GoIosCommandError('Enter a go-ios command, e.g. "apps --list"')
  }
  if (!Object.prototype.hasOwnProperty.call(SHELL_COMMANDS, command)) {
    throw new GoIosCommandError(
      'The command "' + command + '" is not allowed, the allowed ones: ' +
      SHELL_COMMAND_NAMES.join(', ')
    )
  }

  var subcommands = SHELL_COMMANDS[command]
  if (subcommands && !subcommands.includes(args[1] || '')) {
    throw new GoIosCommandError(
      'Only "' + subcommands.map(function(sub) {
        return command + ' ' + sub
      }).join('", "') + '" of "' + command + '" is allowed'
    )
  }

  args.slice(1).forEach(function(arg) {
    var error = arg.startsWith('-') ? optionError(arg) : null
    if (error) {
      throw new GoIosCommandError(error)
    }
  })

  return args
}

// spawnGoIos <serial> <args>: go-ios on the device of the unit, without a shell
export function spawnGoIos(serial: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(GO_IOS_BIN, args.concat('--udid=' + serial), {
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

export interface GoIosResult {
  stdout: string
  stderr: string
}

// goIosError <stderr>: the last error go-ios logged (its logs are JSON lines)
export function goIosError(stderr: string): string {
  var lines = stderr.split('\n').filter(Boolean)
  for (var i = lines.length - 1; i >= 0; i--) {
    try {
      var entry = JSON.parse(lines[i]!) as Record<string, unknown>
      if (entry.level === 'error' || entry.level === 'ERROR' || entry.level === 'fatal') {
        return [entry.msg, entry.err || entry.error].filter(Boolean).join(': ')
      }
    }
    catch {
      return lines[i]!
    }
  }
  return ''
}

// execGoIos <serial> <args> [timeout]: the output of go-ios on the device of the unit; rejects
// with the error go-ios printed when it fails
export function execGoIos(serial: string, args: string[], timeout = 60000): Promise<GoIosResult> {
  return new Promise<GoIosResult>(function(resolve, reject) {
    execFile(
      GO_IOS_BIN
    , args.concat('--udid=' + serial)
    , {timeout: timeout, maxBuffer: 64 * 1024 * 1024}
    , function(err, stdout, stderr) {
        if (err) {
          reject(new Error(goIosError(stderr) || err.message))
          return
        }
        resolve({stdout: stdout, stderr: stderr})
      }
    )
  })
}

// The priorities of the log levels of syslog, as the ones of logcat
// (2 verbose, 3 debug, 4 info, 5 warn, 6 error, 7 fatal)
var SYSLOG_PRIORITIES: Record<string, number> = {
  debug: 3
, info: 4
, notice: 4
, warning: 5
, error: 6
, critical: 7
, alert: 7
, emergency: 7
}

var SYSLOG_LINE = new RegExp(
  '^[A-Z][a-z]{2}\\s+\\d+\\s+\\d{2}:\\d{2}:\\d{2}\\s+\\S+\\s+([^\\[]+)\\[(\\d+)\\]' +
  '(?:\\s+<(\\w+)>)?:\\s?([\\s\\S]*)$'
)

export interface SyslogEntry {
  pid: number
  priority: number
  tag: string
  message: string
}

// parseSyslog <line>: a line of `ios syslog` (JSON with the message in "msg", or the raw message)
export function parseSyslog(line: string): SyslogEntry | null {
  var text = line
  if (line.startsWith('{')) {
    try {
      var parsed = JSON.parse(line) as {msg?: unknown}
      if (typeof parsed.msg !== 'string') {
        return null
      }
      text = parsed.msg
    }
    catch {
      // not JSON, the raw message
    }
  }
  if (!text.trim()) {
    return null
  }

  var match = SYSLOG_LINE.exec(text)
  if (!match) {
    return {pid: 0, priority: 4, tag: '', message: text}
  }
  return {
    pid: Number(match[2])
  , priority: SYSLOG_PRIORITIES[(match[3] || '').toLowerCase()] || 4
  , tag: match[1]!.trim()
  , message: match[4]!
  }
}

// The entries of `ios fsync tree`: S_IFDIR and S_IFREG only, AFC does not give the permissions
var S_IFDIR = 0o040000
var S_IFREG = 0o100000

export interface AfcEntry {
  name: string
  mode: number
  size: number
}

// parseFsyncTree <output>: the entries of the listed directory in the output of `ios fsync tree`,
// which prints the whole tree depth first ("|  " per level, "|-" before the name, "/" after a
// directory), so its children are the lines of the first level
export function parseFsyncTree(output: string): AfcEntry[] {
  var entries: AfcEntry[] = []
  var level = -1

  output.split('\n').forEach(function(line) {
    var match = /^((?:\| {2})*)\|-(.*)$/.exec(line)
    if (!match) {
      return
    }
    var depth = match[1]!.length / 3
    if (level === -1) {
      level = depth
    }
    if (depth !== level) {
      return
    }
    var name = match[2]!
    var directory = name.endsWith('/')
    if (directory) {
      name = name.slice(0, -1)
    }
    if (name) {
      entries.push({
        name: name
      , mode: directory ? S_IFDIR : S_IFREG
      , size: -1
      })
    }
  })

  return entries
}

// afcPath <path>: a path of the media directory of AFC, absolute and without ".."
export function afcPath(path: string): string {
  var parts = path.split('/').filter(function(part) {
    return part && part !== '.'
  })
  if (parts.includes('..')) {
    throw new GoIosCommandError('The path "' + path + '" is not allowed')
  }
  return '/' + parts.join('/')
}

// matchesFilters <entry> <filters>: whether an entry passes the filters of logcat, which keep the
// entries of a tag ("*" for any) from a priority on; no filter keeps everything
export function matchesFilters(
  entry: SyslogEntry
, filters: Array<{tag: string, priority: number}>
): boolean {
  if (!filters.length) {
    return true
  }
  return filters.some(function(filter) {
    return (filter.tag === '*' || filter.tag === entry.tag) && entry.priority >= filter.priority
  })
}

// connectedByUsb <output> <serial>: whether `ios list --details` has the device on a USB
// connection of usbmuxd (not a "Network" one)
export function connectedByUsb(output: string, serial: string): boolean {
  try {
    var list = JSON.parse(output) as {deviceList?: Array<{Udid?: string, ConnectionType?: string}>}
    return (list.deviceList || []).some(function(device) {
      return device.Udid === serial && device.ConnectionType !== 'Network'
    })
  }
  catch {
    return false
  }
}
