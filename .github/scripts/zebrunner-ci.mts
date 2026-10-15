//
// Fork (Zebrunner): applies .github/zebrunner-ci.json to the Android legs of
// .github/android-matrix.json, for plan-matrix.mts and render-report.mts.
//

import fs from 'fs'

interface ZebrunnerCi {
  android?: {minApi?: number}
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
