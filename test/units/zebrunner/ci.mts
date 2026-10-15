// Fork (Zebrunner): the CI settings of the fork, .github/zebrunner-ci.json
import fs from 'node:fs'

import {expect} from 'chai'

import {androidLegs} from '../../../.github/scripts/zebrunner-ci.mts'

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
})
