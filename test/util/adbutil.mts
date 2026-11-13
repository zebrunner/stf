import * as chai from 'chai'
var expect = chai.expect

import Bluebird from 'bluebird'

import adbutil from '../../lib/util/adbutil.js'

describe('adbutil', function() {
  // adbkit 4 returns native promises, the device code chains .timeout() and .return() on them
  it('should convert the promises of adbkit to Bluebird', function() {
    var adb = adbutil()
    var calls: unknown[][] = []
    adb.client.getDevice = (function(serial: string) {
      return {
        getProperties: function() {
          calls.push(['getProperties', serial])
          return Promise.resolve({'ro.product.model': 'Pixel'})
        }
      , waitBootComplete: function(options: unknown) {
          calls.push(['waitBootComplete', serial, options])
          return Promise.resolve(true)
        }
      }
    }) as unknown as typeof adb.client.getDevice

    var properties = adb.getProperties('serial-1')
    expect(properties).to.be.an.instanceof(Bluebird)

    var signal = AbortSignal.timeout(1000)
    var boot = adb.waitBootComplete('serial-1', {signal: signal})
    expect(boot).to.be.an.instanceof(Bluebird)

    return Bluebird.all([properties.timeout(1000), boot.timeout(1000)])
      .then(function(results) {
        expect(results[0]).to.deep.equal({'ro.product.model': 'Pixel'})
        expect(results[1]).to.equal(true)
        expect(calls).to.deep.equal([
          ['getProperties', 'serial-1']
        , ['waitBootComplete', 'serial-1', {signal: signal}]
        ])
      })
  })
})
