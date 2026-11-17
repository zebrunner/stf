// Fork (Zebrunner): .github/scripts/zebrunner-ios-rerun.mts, on the jobs of real CI runs
// (test/fixt/zebrunner-ci-runs.json: the first attempt of each, the fields the script reads)
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import {expect} from 'chai'

import {
  type Job
, MAX_ATTEMPTS
, notAcquired
, optionalLegs
, type Run
, rerunPlan
} from '../../../.github/scripts/zebrunner-ios-rerun.mts'

interface Fixture {
  run: Run
  jobs: Job[]
}

var fixtures = JSON.parse(fs.readFileSync('test/fixt/zebrunner-ci-runs.json', 'utf8')) as
  Record<string, Fixture>

// iOS 15, 17 and 26 not acquired, the optional iOS 27 failed, Report failed
var DISPATCH = '43963653821'
// a pull request, iOS 15 not acquired
var PULL = '43934673364'
// the nightly run of 2026-11-17, green
var NIGHTLY = '44069379678'

function fixture(id: string, run: Partial<Run> = {}) {
  var copy = JSON.parse(JSON.stringify(fixtures[id])) as Fixture
  Object.assign(copy.run, run)
  return copy
}

function withJob(jobs: Job[], name: string, job: Partial<Job>): Job[] {
  return jobs.map(function(other) {
    return other.name === name ? Object.assign({}, other, job) : other
  })
}

describe('zebrunner: CI iOS rerun', function() {
  var optional = optionalLegs()

  it('should take the optional legs from .github/zebrunner-ci.json', function() {
    expect(optional).to.include('ios / iOS 27')
    expect(optional).not.to.include('ios / iOS 18')
  })

  it('should find the iOS legs no runner took', function() {
    var jobs = fixture(DISPATCH).jobs
    expect(jobs.filter(notAcquired).map(function(job) {
      return job.name
    })).to.eql(['ios / iOS 15', 'ios / iOS 17', 'ios / iOS 26'])
    var job = function(name: string, conclusion: string, runner: string | null): Job {
      return {name: name, conclusion: conclusion, runner_name: runner, steps: []}
    }
    expect(notAcquired(job('ios / iOS 18', 'failure', null))).to.equal(true)
    expect(notAcquired(job('ios / iOS plan', 'skipped', null))).to.equal(false)
    expect(notAcquired(job('Build', 'cancelled', ''))).to.equal(false)
    expect(notAcquired(job('ios / iOS 27', 'failure', 'GitHub Actions 1'))).to.equal(false)
    // steps ran: not a leg without a runner, whatever runner_name says
    expect(notAcquired(Object.assign(job('ios / iOS 18', 'cancelled', ''), {steps: [{}]})))
      .to.equal(false)
  })

  it('should run a manual run again whose legs no runner took', function() {
    var {run, jobs} = fixture(DISPATCH)
    var plan = rerunPlan(run, jobs, [run], optional)
    expect(plan.rerun, plan.reason).to.equal(true)
    expect(plan.legs).to.eql(['ios / iOS 15', 'ios / iOS 17', 'ios / iOS 26'])
  })

  it('should run a pull request again whose leg no runner took', function() {
    var {run, jobs} = fixture(PULL)
    var plan = rerunPlan(run, jobs, [], optional)
    expect(plan.rerun, plan.reason).to.equal(true)
    expect(plan.legs).to.eql(['ios / iOS 15'])
  })

  it('should run the nightly run again', function() {
    var {run, jobs} = fixture(NIGHTLY, {conclusion: 'failure'})
    jobs = withJob(jobs, 'ios / iOS 26', {conclusion: 'cancelled', runner_name: '', steps: []})
    jobs = withJob(jobs, 'Report', {conclusion: 'failure'})
    expect(rerunPlan(run, jobs, [], optional).rerun).to.equal(true)
  })

  it('should run the run again up to attempt ' + MAX_ATTEMPTS, function() {
    var {run, jobs} = fixture(PULL, {run_attempt: MAX_ATTEMPTS - 1})
    expect(rerunPlan(run, jobs, [], optional).rerun).to.equal(true)
    run.run_attempt = MAX_ATTEMPTS
    var plan = rerunPlan(run, jobs, [], optional)
    expect(plan.rerun).to.equal(false)
    expect(plan.reason).to.include('last automatic')
  })

  it('should not run a run again that did not fail', function() {
    var {run, jobs} = fixture(NIGHTLY)
    expect(rerunPlan(run, jobs, [], optional)).to.include({rerun: false})
    // cancelled by a newer push or by a person: its legs look the same
    var cancelled = fixture(DISPATCH, {conclusion: 'cancelled'})
    var plan = rerunPlan(cancelled.run, cancelled.jobs, [], optional)
    expect(plan.rerun).to.equal(false)
    expect(plan.reason).to.include('cancelled')
  })

  it('should not run a run again without a leg no runner took', function() {
    var {run, jobs} = fixture(NIGHTLY, {conclusion: 'failure'})
    jobs = withJob(jobs, 'Report', {conclusion: 'failure'})
    var plan = rerunPlan(run, jobs, [], optional)
    expect(plan.rerun).to.equal(false)
    expect(plan.legs).to.eql([])
  })

  it('should not run a real failure again', function() {
    var {run, jobs} = fixture(DISPATCH)
    var plan = rerunPlan(run, withJob(jobs, 'ios / iOS 18', {conclusion: 'failure'}), [], optional)
    expect(plan.rerun).to.equal(false)
    expect(plan.reason).to.include('ios / iOS 18')
    // a timeout or a cancel after the steps started counts as well
    plan = rerunPlan(run, withJob(jobs, 'Android 13 (API 33)', {conclusion: 'cancelled'}), [],
      optional)
    expect(plan.rerun).to.equal(false)
    expect(plan.reason).to.include('Android 13')
    // the optional iOS 27 failed: a failure without the optional legs of the settings
    expect(rerunPlan(run, jobs, [], []).reason).to.include('ios / iOS 27')
  })

  it('should not run a run again that a newer run supersedes', function() {
    var {run, jobs} = fixture(PULL)
    var newer = Object.assign({}, run, {id: run.id + 1, created_at: '2026-11-16T20:00:00Z'})
    var plan = rerunPlan(run, jobs, [newer, run], optional)
    expect(plan.rerun).to.equal(false)
    expect(plan.reason).to.include(String(newer.id))
    // an older run, another branch, or the same branch name of a fork do not
    expect(rerunPlan(run, jobs, [
      Object.assign({}, newer, {created_at: '2026-11-16T18:00:00Z'})
    , Object.assign({}, newer, {head_branch: 'other'})
    , Object.assign({}, newer, {head_repository: {full_name: 'someone/stf'}})
    ], optional).rerun).to.equal(true)
  })

  describe('the command', function() {
    var dir: string

    beforeEach(function() {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-zebrunner-ios-rerun-'))
    })

    afterEach(function() {
      fs.rmSync(dir, {recursive: true, force: true})
    })

    // gh of PATH answers from the fixture and records its calls
    function command(id: string, run: Partial<Run>, env: Record<string, string> = {}) {
      var data = fixture(id, run)
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(
        Object.assign({workflow_id: 1}, data.run)))
      fs.writeFileSync(path.join(dir, 'jobs.json'), data.jobs.map(function(job) {
        return JSON.stringify(job)
      }).join('\n'))
      fs.writeFileSync(path.join(dir, 'gh'), [
        '#!/usr/bin/env node'
      , 'var fs = require("fs"), dir = ' + JSON.stringify(dir)
      , 'var args = process.argv.slice(2)'
      , 'fs.appendFileSync(dir + "/calls", args.join(" ") + "\\n")'
      , 'var url = args.find(function(arg) { return arg.startsWith("repos/") }) || ""'
      , 'if (/\\/jobs/.test(url)) process.stdout.write(fs.readFileSync(dir + "/jobs.json"))'
      , 'else if (/\\/runs$/.test(url)) process.stdout.write("")'
      , 'else if (/\\/runs\\/\\d+$/.test(url))'
      , '  process.stdout.write(fs.readFileSync(dir + "/run.json"))'
      ].join('\n'), {mode: 0o755})
      var result = spawnSync(process.execPath, ['.github/scripts/zebrunner-ios-rerun.mts'], {
        encoding: 'utf8'
      , env: Object.assign({}, process.env, {
          PATH: dir + path.delimiter + process.env.PATH
        , GH_REPO: 'zebrunner/stf'
        , RUN_ID: id
        , RUN_ATTEMPT: String(data.run.run_attempt)
        , GITHUB_STEP_SUMMARY: ''
        , DRY_RUN: ''
        }, env)
      })
      return {
        result: result
      , calls: fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n')
      }
    }

    it('should run the failed jobs of the run again', function() {
      var {result, calls} = command(DISPATCH, {})
      expect(result.status, result.stderr).to.equal(0)
      expect(result.stdout).to.include('running the failed jobs again')
      expect(calls).to.include('run rerun ' + DISPATCH + ' --failed -R zebrunner/stf')
      expect(calls[1]).to.include('/attempts/1/jobs')
    })

    it('should only decide on a dry run', function() {
      var {result, calls} = command(DISPATCH, {}, {DRY_RUN: '1'})
      expect(result.status, result.stderr).to.equal(0)
      expect(result.stdout).to.include('running the failed jobs again')
      expect(calls.join('\n')).not.to.include('rerun')
    })

    it('should not run it again when another attempt started', function() {
      var {result, calls} = command(PULL, {run_attempt: 2}, {RUN_ATTEMPT: '1'})
      expect(result.status, result.stderr).to.equal(0)
      expect(result.stdout).to.include('attempt 2 already started')
      expect(calls).to.have.length(1)
    })

    it('should not run a green run again', function() {
      var {result, calls} = command(NIGHTLY, {})
      expect(result.status, result.stderr).to.equal(0)
      expect(result.stdout).to.include('not running it again')
      expect(calls.join('\n')).not.to.include('rerun')
    })
  })
})
