import {expect} from 'chai'

import {modelFlags} from '../../lib/units/device/plugins/util/flags.js'

describe('device: flags', function() {
  it('should keep the flags of the models that stf-device-db 1 had', function() {
    // The identity drops the brand of "Lenovo B6000-F", leaving the space
    expect(modelFlags(' B6000-F')).to.deep.equal({forceTouchOrigin: 'bottom left'})
    expect(modelFlags('F-06F')).to.deep.equal({forceMaxPressure: 10000, forceTouchMode: 'pressure'})
    expect(modelFlags('SC-03D')).to.deep.equal({forceMinScreenScale: 1})
  })

  it('should have no flags for the other models', function() {
    expect(modelFlags('Pixel 7')).to.equal(null)
    expect(modelFlags('')).to.equal(null)
    expect(modelFlags(null)).to.equal(null)
    expect(modelFlags('hasOwnProperty')).to.equal(null)
  })
})
