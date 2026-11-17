//
// Fork (Zebrunner): runs the iOS legs of a failed CI run again when no runner
// took them (zebrunner-ci-ios-rerun.yml, ZEBRUNNER.md#ci).
//
// When the hosted macOS runners are short, GitHub cancels a queued macOS job
// after about 15 minutes ("The job was not acquired by Runner of type hosted
// even after multiple attempts"): the job has no runner and no step, the leg has
// no verdict and the Report job fails the run. Such a run is run again with
// `gh run rerun --failed` (its failed and cancelled jobs, Report among them, and
// the jobs that need them; the other jobs keep their results and verdicts), up
// to attempt MAX_ATTEMPTS. Not run again: a run that did not fail (a cancelled
// one was cancelled by a newer run or a person), a run with a newer run of the
// same event and branch (the rerun would cancel it through the concurrency
// group of ci.yml), and a run in which a job that ran failed (a real failure:
// running it again could hide it; a person decides), the optional iOS legs of
// .github/zebrunner-ci.json and Report (it fails for the missing verdicts) aside.
//
// usage: node zebrunner-ios-rerun.mts (env: GH_REPO, RUN_ID, RUN_ATTEMPT,
//          GH_TOKEN with actions: write; DRY_RUN=1 decides without running again)
//

import fs from 'fs'
import {spawnSync} from 'child_process'

import {iosLegs} from './zebrunner-ci.mts'

// the first attempt and two automatic reruns
export const MAX_ATTEMPTS = 3

export interface Run {
  id: number
  event: string
  conclusion: string | null
  run_attempt: number
  created_at: string
  head_branch: string | null
  head_repository?: {full_name: string} | null
}

export interface Job {
  name: string
  conclusion: string | null
  runner_name: string | null
  steps?: unknown[]
}

export interface RerunPlan {
  rerun: boolean
  reason: string
  // the iOS legs no runner took
  legs: string[]
}

const IOS_LEG = /^ios \/ iOS \d/
const REPORT = 'Report'
const FAILED = ['failure', 'cancelled', 'timed_out']

function ran(job: Job): boolean {
  return Boolean(job.runner_name) || (job.steps || []).length > 0
}

export function notAcquired(job: Job): boolean {
  return IOS_LEG.test(job.name) &&
    (job.conclusion === 'cancelled' || job.conclusion === 'failure') && !ran(job)
}

// The job names of the optional iOS legs, which may fail without failing the run
export function optionalLegs(): string[] {
  return iosLegs('full').filter(function(leg) {
    return leg.optional
  }).map(function(leg) {
    return 'ios / iOS ' + leg.ios
  })
}

// runs: the other runs of the workflow, the newer ones of the same event and
// branch supersede this one
export function rerunPlan(run: Run, jobs: Job[], runs: Run[], optional: string[]): RerunPlan {
  var legs = jobs.filter(notAcquired).map(function(job) {
    return job.name
  })
  var plan = function(rerun: boolean, reason: string): RerunPlan {
    return {rerun: rerun, reason: reason, legs: legs}
  }

  if (run.conclusion !== 'failure') {
    return plan(false, 'the run did not fail (' + run.conclusion + ')')
  }
  if (!legs.length) {
    return plan(false, 'no iOS leg was left without a runner')
  }
  if (run.run_attempt >= MAX_ATTEMPTS) {
    return plan(false, 'attempt ' + run.run_attempt + ' was the last automatic one (' +
      MAX_ATTEMPTS + ')')
  }

  var failed = jobs.filter(function(job) {
    return ran(job) && FAILED.includes(job.conclusion || '') && job.name !== REPORT &&
      !optional.includes(job.name)
  }).map(function(job) {
    return job.name
  })
  if (failed.length) {
    return plan(false, 'jobs that ran failed (' + failed.join(', ') +
      '): a rerun of the failed jobs would run them again')
  }

  var newer = runs.filter(function(other) {
    return other.id !== run.id && other.event === run.event &&
      other.head_branch === run.head_branch &&
      (other.head_repository || {}).full_name === (run.head_repository || {}).full_name &&
      other.created_at > run.created_at
  })
  if (newer.length) {
    return plan(false, 'run ' + newer[0]!.id + ' of the same event and branch is newer')
  }

  return plan(true, 'no runner took ' + legs.join(', '))
}

function gh(args: string[]): string {
  var result = spawnSync('gh', args, {encoding: 'utf8'})
  if (result.status !== 0) {
    throw new Error('gh ' + args.join(' ') + ' failed: ' + (result.stderr || '').trim())
  }
  return result.stdout
}

function lines<T>(output: string): T[] {
  return output.split('\n').filter(Boolean).map(function(line) {
    return JSON.parse(line) as T
  })
}

function main() {
  var repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY || ''
  var id = process.env.RUN_ID || ''
  if (!repo || !id) {
    throw new Error('GH_REPO and RUN_ID are required')
  }

  var latest = JSON.parse(gh(['api', 'repos/' + repo + '/actions/runs/' + id])) as
    Run & {workflow_id: number}
  var attempt = Number(process.env.RUN_ATTEMPT || latest.run_attempt)
  var plan: RerunPlan
  if (latest.run_attempt !== attempt) {
    plan = {rerun: false, reason: 'attempt ' + latest.run_attempt + ' already started', legs: []}
  }
  else {
    var jobs = lines<Job>(gh([
      'api', '--paginate'
    , 'repos/' + repo + '/actions/runs/' + id + '/attempts/' + attempt + '/jobs?per_page=100'
    , '--jq', '.jobs[]'
    ]))
    var runs = lines<Run>(gh([
      'api', '-X', 'GET', 'repos/' + repo + '/actions/workflows/' + latest.workflow_id + '/runs'
    , '-f', 'event=' + latest.event, '-f', 'branch=' + (latest.head_branch || '')
    , '-F', 'per_page=20', '--jq', '.workflow_runs[]'
    ]))
    plan = rerunPlan(latest, jobs, runs, optionalLegs())
  }

  var summary = 'CI run ' + id + ' attempt ' + attempt + ': ' +
    (plan.rerun ? 'running the failed jobs again, ' : 'not running it again, ') + plan.reason
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
  }
  if (plan.rerun && process.env.DRY_RUN !== '1') {
    gh(['run', 'rerun', id, '--failed', '-R', repo])
    console.log('::notice::' + summary)
  }
}

if (/zebrunner-ios-rerun\.mts$/.test(process.argv[1] || '')) {
  main()
}
