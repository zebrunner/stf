// Fork (Zebrunner): the CI settings of the fork, .github/zebrunner-ci.json
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'

import {
  androidLegs
, IOS_CHECKS
, iosLegs
, iosMissing
, iosReport
, iosVerdict
, matrixProfile
} from '../../../.github/scripts/zebrunner-ci.mts'

interface Leg {
  android: string
  api: string
}

var matrix = JSON.parse(fs.readFileSync('.github/android-matrix.json', 'utf8')) as {include: Leg[]}

describe('zebrunner: CI', function() {
  it('should test Android 12 (API 31) and later only', function() {
    var legs = androidLegs(matrix.include, 'full')
    expect(legs.length).to.be.above(0)
    legs.forEach(function(leg) {
      expect(parseFloat(leg.api), leg.android).to.be.at.least(31)
    })
    expect(legs.map(function(leg) {
      return leg.api
    })).to.include.members(['31', '32', '33', '34', '35', '36'])
  })

  it('should keep every upstream leg from API 31 on, including the minor levels', function() {
    var upstream = matrix.include.filter(function(leg) {
      return parseFloat(leg.api) >= 31
    })
    expect(androidLegs(matrix.include, 'full')).to.eql(upstream)
  })

  it('should select the floor and newest stable APIs of the two newest Android majors', function() {
    expect(androidLegs(matrix.include, 'quick').map(function(leg) {
      return leg.api
    })).to.eql(['31', '36.1', '37.1'])
  })

  it('should select the same quick legs regardless of matrix ordering', function() {
    expect(androidLegs(matrix.include.slice().reverse(), 'quick'))
      .to.eql(androidLegs(matrix.include, 'quick'))
  })

  it('should not duplicate legs when fewer than three stable versions exist', function() {
    expect(androidLegs([{api: '31'}, {api: '32'}], 'quick')).to.eql([{api: '31'}, {api: '32'}])
    expect(androidLegs([], 'quick')).to.eql([])
  })

  it('should reject duplicate or invalid APIs before quick selection can hide them', function() {
    expect(function() {
      androidLegs([{api: '33'}, {api: '33'}, {api: '36'}, {api: '37'}], 'quick')
    }).to.throw('unique, positive numeric API')
    expect(function() {
      androidLegs([{api: 'broken'}], 'quick')
    }).to.throw('unique, positive numeric API')
  })

  it('should reject an unknown profile instead of silently reducing coverage', function() {
    var original = process.env.CI_MATRIX_PROFILE
    try {
      process.env.CI_MATRIX_PROFILE = 'typo'
      expect(matrixProfile).to.throw('Unknown CI matrix profile: typo')
    }
    finally {
      if (typeof original === 'undefined') {
        delete process.env.CI_MATRIX_PROFILE
      }
      else {
        process.env.CI_MATRIX_PROFILE = original
      }
    }
  })

  describe('iOS', function() {
    var dir: string

    beforeEach(function() {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-zebrunner-ios-'))
    })

    afterEach(function() {
      fs.rmSync(dir, {recursive: true, force: true})
    })

    function verdict(
      stages: string, results: object | null, outcomes = ['success', 'success'], version = '17'
    ) {
      fs.writeFileSync(path.join(dir, 'stages'), stages)
      if (results) {
        fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results))
      }
      return iosVerdict({
        IOS_VERSION: version
      , SETUP_OUTCOME: outcomes[0]
      , TEST_OUTCOME: outcomes[1]
      , STAGES_FILE: path.join(dir, 'stages')
      , RESULTS_FILE: path.join(dir, 'results.json')
      })
    }

    function passingTests() {
      return IOS_CHECKS.slice(2).map(function(check) {
        return {title: '[check:' + check.key + '] test', currentRetry: 0}
      })
    }

    it('should test iOS 15 to 27', function() {
      expect(iosLegs('full').map(function(leg) {
        return leg.ios
      })).to.eql(['15', '16', '17', '18', '26', '27'])
    })

    it('should leave preview iOS to the full matrix', function() {
      expect(iosLegs('quick').map(function(leg) {
        return leg.ios
      })).to.eql(['15', '18', '26'])
    })

    it('should pass a leg whose checks pass', function() {
      var result = verdict('xcode=16.4\nruntime=17.5\nsimulator=A\nwda=up\n', {
        passes: passingTests()
      })
      expect(result.status).to.equal('pass')
      expect(result.details).to.equal('14 checks pass')
      expect(result.extra).to.deep.include({ios: '17', runtime: '17.5', xcode: '16.4'})
      expect(result.extra.checks).to.include({
        simulator: 'pass', wda: 'pass', session: 'pass', stream: 'pass', url: 'pass'
      })
    })

    it('should fail a truncated test run even when the executed checks pass', function() {
      var result = verdict('simulator=A\nwda=up\n', {
        passes: [{title: '[check:session] a'}]
      })
      expect(result.status).to.equal('fail')
      expect(result.extra.checks.stream).to.equal('fail')
    })

    it('should not turn a skipped required check green', function() {
      var result = verdict('simulator=A\nwda=up\n', {
        passes: passingTests().filter(function(test) {
          return !test.title.includes('[check:touch]')
        })
      , pending: [{title: '[check:touch] test'}]
      })
      expect(result.status).to.equal('fail')
      expect(result.extra.checks.touch).to.equal('fail')
    })

    it('should allow the explicitly unsupported URL check to skip before iOS 17', function() {
      var result = verdict('simulator=A\nwda=up\n', {
        passes: passingTests().filter(function(test) {
          return !test.title.includes('[check:url]')
        })
      , pending: [{title: '[check:url] test'}]
      }, ['success', 'success'], '16')
      expect(result.status).to.equal('pass')
      expect(result.extra.checks.url).to.equal('skip')
    })

    it('should fail an untagged hook failure even if every capability passed', function() {
      var result = verdict('simulator=A\nwda=up\n', {
        passes: passingTests()
      , failures: [{title: '"after each" hook', err: {message: 'device absent'}}]
      }, ['success', 'failure'])
      expect(result.status).to.equal('fail')
      expect(result.details).to.equal('test suite failed: device absent')
    })

    it('should expose tests that only passed after retrying', function() {
      var passes = passingTests()
      passes[0]!.currentRetry = 2
      var result = verdict('simulator=A\nwda=up\n', {passes: passes})
      expect(result.status).to.equal('pass')
      expect(result.extra.retried).to.equal(1)
    })

    it('should name the first check that failed', function() {
      var result = verdict('simulator=A\nwda=up\n', {
        passes: passingTests().filter(function(test) {
          return !test.title.includes('[check:stream]')
        })
      , failures: [{title: '[check:stream] b', err: {message: 'no JPEG frame\n  at x'}}]
      }, ['success', 'failure'])
      expect(result.status).to.equal('fail')
      expect(result.details).to.equal('no MJPEG frame: no JPEG frame')
    })

    it('should fail at the stage the setup did not reach', function() {
      var result = verdict('runtime=16.4\nsimulator=A\n', null, ['failure', 'skipped'])
      expect(result.status).to.equal('fail')
      expect(result.extra.checks).to.include({simulator: 'pass', wda: 'fail'})
      expect(result.details).to.equal('WebDriverAgent did not start')
    })

    it('should fail the legs that did not report', function() {
      var missing = iosMissing({'ios-18': true})
      expect(missing.map(function(v) {
        return v.id
      })).to.eql(iosLegs().filter(function(leg) {
        return leg.ios !== '18'
      }).map(function(leg) {
        return 'ios-' + leg.ios
      }))
      expect(missing[0]!.status).to.equal('fail')
    })

    it('should render a matrix of the iOS legs and count their failures', function() {
      var report = iosReport([
        {id: 'ios-26', label: 'iOS 26', group: 'ios', status: 'pass', ios: '26'
        , checks: {wda: 'pass'}}
      , {id: 'ios-15', label: 'iOS 15', group: 'ios', status: 'fail', ios: '15', checks: {}}
      , {id: 'unit', label: 'Unit', status: 'pass'}
      ])
      expect(report.failed).to.equal(1)
      expect(report.summary).to.equal('2 iOS versions (1 passing)')
      expect(report.lines[0]).to.equal('### iOS simulator matrix')
      expect(report.lines[4]).to.match(/^\| :x: \| 15 \|/)
      expect(report.lines[5]).to.match(/^\| :white_check_mark: \| 26 \|/)
    })

    // iOS 27 is optional in .github/zebrunner-ci.json
    it('should show a failing optional leg without counting it', function() {
      var report = iosReport([
        {id: 'ios-27', label: 'iOS 27', group: 'ios', status: 'fail', ios: '27', checks: {}}
      , {id: 'ios-26', label: 'iOS 26', group: 'ios', status: 'pass', ios: '26', checks: {}}
      , {id: 'ios-15', label: 'iOS 15', group: 'ios', status: 'fail', ios: '15', checks: {}}
      ])
      expect(report.failed).to.equal(1)
      expect(report.summary).to.equal('3 iOS versions (1 passing, 1 optional failing)')
      expect(report.lines[4]).to.match(/^\| :x: \| 15 \|/)
      expect(report.lines[6]).to.match(/^\| :warning: \| 27 \|/)
      expect(report.lines.join('\n'))
        .to.match(/iOS 27 is optional, it does not fail the report: .*#1083/)
      expect(iosMissing({}).length).to.equal(iosLegs().length)
    })

    it('should use the selected profile for missing-verdict coverage in the report', function() {
      for (var profile of ['quick', 'full']) {
        var report = path.join(dir, profile + '.md')
        var run = spawnSync(process.execPath, [
          '.github/scripts/render-report.mts', path.join(dir, 'missing'), report
        ], {
          encoding: 'utf8'
        , env: {...process.env, CI_MATRIX_PROFILE: profile
          , EXPECTED_ANDROID_FILE: '.github/android-matrix.json'}
        })
        expect(run.status, run.stderr).to.equal(0)
        var text = fs.readFileSync(report, 'utf8')
        expect(text).to.include('**OS coverage: ' + profile + '**')
        expect(text.includes('**Android 13 (API 33)**')).to.equal(profile === 'full')
        expect(text.includes('**iOS 16**')).to.equal(profile === 'full')
        expect(text).to.include('no verdict')
      }
    })

    it('should show recovered failures as warnings instead of claiming all green', function() {
      var verdicts = path.join(dir, 'verdicts')
      fs.mkdirSync(verdicts)
      iosLegs('quick').forEach(function(leg) {
        fs.writeFileSync(path.join(verdicts, leg.ios + '.json'), JSON.stringify({
          id: 'ios-' + leg.ios, label: 'iOS ' + leg.ios, group: 'ios'
        , status: 'pass', ios: leg.ios, retried: 1
        }))
      })
      var report = path.join(dir, 'report.md')
      var run = spawnSync(process.execPath, [
        '.github/scripts/render-report.mts', verdicts, report
      ], {
        encoding: 'utf8'
      , env: {...process.env, CI_MATRIX_PROFILE: 'quick'
        , EXPECTED_ANDROID_FILE: '', EXPECTED_TIERS: ''}
      })
      expect(run.status, run.stderr).to.equal(0)
      var text = fs.readFileSync(report, 'utf8')
      expect(text).to.include('Passing with warnings')
      expect(text).to.include('Tests retried after failure')
      expect(text).not.to.include('All green')
    })
  })

  describe('Playwright reporting', function() {
    function summary(report: object | null) {
      var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-ci-playwright-'))
      try {
        var input = path.join(dir, 'report.json')
        var output = path.join(dir, 'summary.json')
        if (report) {
          fs.writeFileSync(input, JSON.stringify(report))
        }
        var run = spawnSync(process.execPath, [
          '.github/scripts/playwright-checks.mts', input, output
        ], {encoding: 'utf8'})
        expect(run.status, run.stderr).to.equal(0)
        return JSON.parse(fs.readFileSync(output, 'utf8')) as {
          checks: Record<string, string>, flaky: number
        }
      }
      finally {
        fs.rmSync(dir, {recursive: true, force: true})
      }
    }

    it('should report retried passing tests separately from clean passes', function() {
      var result = summary({specs: [
        {title: '[check:touch_roundtrip] tap', tests: [{status: 'flaky'}]}
      ]})
      expect(result.checks.touch_roundtrip).to.equal('pass')
      expect(result.flaky).to.equal(1)
    })

    it('should fail a suite-level error even if individual tests passed', function() {
      var result = summary({
        specs: [{title: '[check:playwright_ui] ui', tests: [{status: 'expected'}]}]
      , errors: [{message: 'global teardown failed'}]
      })
      expect(result.checks.playwright_ui).to.equal('fail')
    })

    it('should not report a missing, empty or entirely skipped suite as passing', function() {
      for (var report of [null, {}, {
        specs: [{title: '[check:playwright_ui] ui', tests: [{status: 'skipped'}]}]
      }]) {
        expect(summary(report).checks.playwright_ui).to.equal('fail')
      }
    })

    it('should fail unknown outcomes rather than interpreting them as passes', function() {
      var result = summary({specs: [
        {title: '[check:playwright_ui] ui', tests: [{status: 'unknown'}]}
      ]})
      expect(result.checks.playwright_ui).to.equal('fail')
    })
  })
})
