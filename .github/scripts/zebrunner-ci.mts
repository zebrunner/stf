//
// Fork (Zebrunner): the CI settings of .github/zebrunner-ci.json.
//
// - androidLegs: the Android legs of .github/android-matrix.json from
//   android.minApi on, for plan-matrix.mts and render-report.mts
// - the iOS legs of zebrunner-ios.yml (ios.include) and their part of the report
//   of render-report.mts: the expected legs and a matrix like the Android one
//
// usage: node zebrunner-ci.mts ios-matrix
//        node zebrunner-ci.mts ios-verdict (env: IOS_VERSION, SETUP_OUTCOME,
//          TEST_OUTCOME, RESULTS_FILE, STAGES_FILE; writes GITHUB_OUTPUT)
//

import fs from 'fs'

export interface IosLeg {
  ios: string
  runner: string
  xcode?: string
  download?: string
  // Why the leg does not count in the report for now, and what makes it required again
  optional?: string
}

interface ZebrunnerCi {
  android?: {minApi?: number}
  ios?: {include?: IosLeg[]}
}

export interface IosVerdict {
  id: string
  label: string
  group?: string
  status: string
  details?: string
  ios?: string
  runtime?: string
  xcode?: string
  checks?: Record<string, string | undefined>
}

function settings(): ZebrunnerCi {
  var file = '.github/zebrunner-ci.json'
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as ZebrunnerCi : {}
}

// androidLegs <legs>: the legs at or above android.minApi, all of them without the setting
export function androidLegs<T extends {api: unknown}>(legs: T[]): T[] {
  const minApi = settings().android?.minApi
  if (typeof minApi !== 'number') {
    return legs
  }
  return legs.filter(function(leg) {
    return parseFloat(String(leg.api)) >= minApi
  })
}

export function iosLegs(): IosLeg[] {
  return settings().ios?.include || []
}

// The columns of the iOS matrix, in the order a leg reaches them. The test keys are the
// [check:<key>] tags of the test titles of test/zebrunner-ios.
export const IOS_CHECKS = [
  {key: 'simulator', label: 'Simulator', failure: 'the simulator did not boot'}
, {key: 'wda', label: 'WDA', failure: 'WebDriverAgent did not start'}
, {key: 'session', label: 'Session', failure: 'no WDA session'}
, {key: 'appium', label: 'Appium kept', failure: 'the session of an Appium test was not kept'}
, {key: 'size', label: 'Size', failure: 'wrong screen size'}
, {key: 'device', label: 'Orientation', failure: 'no orientation or battery'}
, {key: 'home', label: 'Home', failure: 'the home button did not work'}
, {key: 'touch', label: 'Touch', failure: 'tap or swipe failed'}
, {key: 'screenshot', label: 'Screenshot', failure: 'no screenshot'}
, {key: 'settings', label: 'Settings', failure: 'Settings did not open or the app was lost'}
, {key: 'clipboard', label: 'Clipboard', failure: 'the pasteboard was not written or read'}
, {key: 'url', label: 'URL', failure: 'Safari did not open the address'}
, {key: 'stream', label: 'Stream', failure: 'no MJPEG frame'}
, {key: 'stable', label: 'Stable', failure: 'the unit would have stopped'}
]

const NO_VERDICT = 'no verdict: it never ran, was cancelled, or died before reporting'

// iosMissing <seen>: a failing verdict for every expected leg that did not report
export function iosMissing(seen: Record<string, boolean>): IosVerdict[] {
  return iosLegs().filter(function(leg) {
    return !seen['ios-' + leg.ios]
  }).map(function(leg) {
    return {
      id: 'ios-' + leg.ios
    , label: 'iOS ' + leg.ios
    , group: 'ios'
    , status: 'fail'
    , ios: leg.ios
    , checks: {}
    , details: NO_VERDICT
    }
  })
}

const ICON: Record<string, string> = {
  pass: ':white_check_mark:'
, fail: ':x:'
, skip: ':fast_forward:'
, cancel: ':heavy_minus_sign:'
}

const CHECK_ICON: Record<string, string> = {
  pass: ':white_check_mark:'
, fail: ':x:'
, skip: ':heavy_minus_sign:'
}

// iosReport <verdicts>: the iOS part of the report, from the verdicts of the group ios
// iosOptional: the reason of every optional leg, by its iOS version
export function iosOptional(): Record<string, string> {
  var optional: Record<string, string> = {}
  iosLegs().forEach(function(leg) {
    if (leg.optional) {
      optional[leg.ios] = leg.optional
    }
  })
  return optional
}

export function iosReport(verdicts: IosVerdict[]) {
  var optional = iosOptional()
  var ios = verdicts.filter(function(v) {
    return v.group === 'ios'
  }).sort(function(a, b) {
    return Number(a.ios) - Number(b.ios)
  })
  var failing = ios.filter(function(v) {
    return v.status === 'fail'
  })
  // An optional leg is in the matrix, but does not fail the report
  var failed = failing.filter(function(v) {
    return !optional[v.ios || '']
  }).length
  var lines: string[] = []

  if (ios.length) {
    lines.push('### iOS simulator matrix')
    lines.push('')
    var header = ['', 'iOS', 'Runtime', 'Xcode'].concat(IOS_CHECKS.map(function(check) {
      return check.label
    }))
    lines.push('| ' + header.join(' | ') + ' |')
    lines.push('|' + header.map(function() {
      return '---'
    }).join('|') + '|')
    ios.forEach(function(v) {
      var checks = v.checks || {}
      lines.push('| ' + [
        v.status === 'fail' && optional[v.ios || ''] ? ':warning:' : ICON[v.status] || ':question:'
      , v.ios || '?'
      , v.runtime || '-'
      , v.xcode || '-'
      ].concat(IOS_CHECKS.map(function(check) {
        return CHECK_ICON[checks[check.key] || 'skip'] || ':question:'
      })).join(' | ') + ' |')
    })
    lines.push('')
    lines.push('<sub>WebDriverAgent on an iPhone simulator against the WDA client of the ' +
      'ios-device unit (test/zebrunner-ios). A red column: ' +
      IOS_CHECKS.map(function(check) {
        return check.label + ', ' + check.failure
      }).join(' · ') + '</sub>')
    lines.push('')
    ios.forEach(function(v) {
      if (optional[v.ios || '']) {
        lines.push('> [!NOTE]')
        lines.push('> iOS ' + v.ios + ' is optional, it does not fail the report: ' +
          optional[v.ios || ''])
        lines.push('')
      }
    })
  }

  return {
    lines: lines
  , failed: failed
  , summary: ios.length + ' iOS versions (' + (ios.length - failing.length) + ' passing' +
      (failing.length > failed ? ', ' + (failing.length - failed) + ' optional failing' : '') + ')'
  }
}

interface MochaTest {
  title: string
  err?: {message?: string}
}

interface MochaResults {
  passes?: MochaTest[]
  failures?: MochaTest[]
  pending?: MochaTest[]
}

function checkKey(title: string): string | null {
  var match = /\[check:([a-z]+)\]/.exec(title)
  return match ? match[1]! : null
}

function readStages(file: string): Record<string, string> {
  var stages: Record<string, string> = {}
  if (fs.existsSync(file)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach(function(line) {
      var index = line.indexOf('=')
      var name = (index === -1 ? line : line.slice(0, index)).trim()
      if (name) {
        stages[name] = index === -1 ? '' : line.slice(index + 1).trim()
      }
    })
  }
  return stages
}

// iosVerdict <env>: the status, details and extra of a leg, from the stages the setup script
// reached and the JSON results of mocha
export function iosVerdict(env: NodeJS.ProcessEnv) {
  var stages = readStages(env.STAGES_FILE || 'ios-logs/stages')
  var resultsFile = env.RESULTS_FILE || 'ios-results.json'
  var results = (fs.existsSync(resultsFile) ?
    JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : {}) as MochaResults
  var checks: Record<string, string> = {
    simulator: 'simulator' in stages ? 'pass' : 'fail'
  , wda: 'wda' in stages ? 'pass' : ('simulator' in stages ? 'fail' : 'skip')
  }
  var messages: string[] = []

  function record(tests: MochaTest[] | undefined, status: string) {
    (tests || []).forEach(function(test) {
      var key = checkKey(test.title)
      if (key) {
        checks[key] = status
        if (status === 'fail') {
          messages.push(String(test.err?.message || 'failed').split('\n')[0]!)
        }
      }
    })
  }
  record(results.passes, 'pass')
  record(results.pending, 'skip')
  record(results.failures, 'fail')

  var failing = IOS_CHECKS.filter(function(check) {
    return checks[check.key] === 'fail'
  })
  var passing = IOS_CHECKS.filter(function(check) {
    return checks[check.key] === 'pass'
  })
  var ok = !failing.length && (results.passes || []).length > 0 &&
    env.SETUP_OUTCOME === 'success' && env.TEST_OUTCOME === 'success'
  var details = ok ? passing.length + ' checks pass' :
    failing.length ? failing[0]!.failure + (messages.length ? ': ' + messages[0] : '') :
    'the tests did not run'

  return {
    status: ok ? 'pass' : 'fail'
  , details: details
  , extra: {
      ios: env.IOS_VERSION || ''
    , runtime: stages.runtime || ''
    , xcode: stages.xcode || ''
    , checks: checks
    }
  }
}

function main(command: string | undefined) {
  if (command === 'ios-matrix') {
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT,
        'matrix=' + JSON.stringify({include: iosLegs()}) + '\n')
    }
    console.log(iosLegs().length + ' iOS legs planned')
  }
  else if (command === 'ios-verdict') {
    var verdict = iosVerdict(process.env)
    console.log(JSON.stringify(verdict, null, 2))
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, [
        'status=' + verdict.status
      , 'details=' + verdict.details.replace(/\n/g, ' ')
      , 'extra=' + JSON.stringify(verdict.extra)
      ].join('\n') + '\n')
    }
  }
}

if (/zebrunner-ci\.mts$/.test(process.argv[1] || '')) {
  main(process.argv[2])
}
