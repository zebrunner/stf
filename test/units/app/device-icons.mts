import fs from 'fs'

import {expect} from 'chai'
import express from 'express'

import deviceIcons from '../../../lib/units/app/middleware/device-icons.js'
import pathutil from '../../../lib/util/pathutil.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

describe('app: device icons', function() {
  var server: Running

  before(async function() {
    var app = express()
    app.use('/static/app/devices', deviceIcons())
    server = await listen(app)
  })

  after(function() {
    return server.close()
  })

  function get(path: string) {
    return fetch(server.origin + '/static/app/devices' + path)
  }

  it('should serve the icons of the platforms', async function() {
    var icons: Array<[string, string, string]> = [
      ['Android', 'x120', 'Android.jpg']
    , ['iOS', 'x24', 'iOS.jpg']
    , ['tvOS', 'x120', 'tvOS.png']
    ]
    for (var [name, size, file] of icons) {
      var res = await get('/icon/' + size + '/' + name)
      expect(res.status, name).to.equal(200)
      expect(Buffer.from(await res.arrayBuffer()))
        .to.deep.equal(fs.readFileSync(pathutil.root('icon/' + size + '/' + file)))
    }
  })

  it('should draw the devices of the db and the default icon as SVG', async function() {
    for (var path of [
      '/icon/x120/Nexus_5.svg'
    , '/icon/x24/SM-G991B.svg'
    , '/photo/x800/Pixel_7.svg'
    , '/icon/x120/_default.jpg'
    ]) {
      var res = await get(path)
      expect(res.status, path).to.equal(200)
      expect(res.headers.get('content-type'), path).to.equal('image/svg+xml; charset=utf-8')
      expect(res.headers.get('x-content-type-options'), path).to.equal('nosniff')
      expect(res.headers.get('content-security-policy'), path).to.contain('default-src \'none\'')
      expect(await res.text(), path).to.match(/^<svg /)
    }
  })

  it('should not answer an unknown device or size', async function() {
    for (var path of [
      '/icon/x120/No_Such_Device_42.svg'
    , '/icon/x800/Nexus_5.svg'
    , '/photo/x120/Nexus_5.svg'
    , '/video/x120/Nexus_5.svg'
    ]) {
      expect((await get(path)).status, path).to.equal(404)
    }
  })
})
