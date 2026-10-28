// Fork (Zebrunner): the CI settings of the fork, .github/zebrunner-ci.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'

import {
  androidLegs
, iosLegs
, iosMissing
, iosReport
, iosVerdict
} from '../../../.github/scripts/zebrunner-ci.mts'

interface Leg {
  android: string
  api: string
}

var matrix = JSON.parse(fs.readFileSync('.github/android-matrix.json', 'utf8')) as {include: Leg[]}

describe('zebrunner: CI', function() {
  it('should test Android 12 (API 31) and later only', function() {
    var legs = androidLegs(matrix.include)
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
    expect(androidLegs(matrix.include)).to.eql(upstream)
  })

  describe('iOS', function() {
    var dir: string

    beforeEach(function() {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-zebrunner-ios-'))
    })

    afterEach(function() {
      fs.rmSync(dir, {recursive: true, force: true})
    })

    function verdict(stages: string, results: object | null, outcomes = ['success', 'success']) {
      fs.writeFileSync(path.join(dir, 'stages'), stages)
      if (results) {
        fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results))
      }
      return iosVerdict({
        IOS_VERSION: '17'
      , SETUP_OUTCOME: outcomes[0]
      , TEST_OUTCOME: outcomes[1]
      , STAGES_FILE: path.join(dir, 'stages')
      , RESULTS_FILE: path.join(dir, 'results.json')
      })
    }

    it('should test iOS 15 to 27', function() {
      expect(iosLegs().map(function(leg) {
        return leg.ios
      })).to.eql(['15', '16', '17', '18', '26', '27'])
    })

    it('should pass a leg whose checks pass', function() {
      var result = verdict('xcode=16.4\nruntime=17.5\nsimulator=A\nwda=up\n', {
        passes: [{title: '[check:session] a'}, {title: '[check:stream] b'}]
      , pending: [{title: '[check:url] c'}]
      })
      expect(result.status).to.equal('pass')
      expect(result.details).to.equal('4 checks pass')
      expect(result.extra).to.deep.include({ios: '17', runtime: '17.5', xcode: '16.4'})
      expect(result.extra.checks).to.include({
        simulator: 'pass', wda: 'pass', session: 'pass', stream: 'pass', url: 'skip'
      })
    })

    it('should name the first check that failed', function() {
      var result = verdict('simulator=A\nwda=up\n', {
        passes: [{title: '[check:session] a'}]
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
      var missing = iosMissing({'ios-17': true})
      expect(missing.map(function(v) {
        return v.id
      })).to.eql(['ios-15', 'ios-16', 'ios-18', 'ios-26', 'ios-27'])
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
      expect(iosMissing({}).find(function(v) {
        return v.id === 'ios-27'
      })!.status).to.equal('fail')
    })
  })
})
