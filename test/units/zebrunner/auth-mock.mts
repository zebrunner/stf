// Fork (Zebrunner): the mock sign-in hands out a short token, lib/units/auth/mock.ts
import {expect} from 'chai'
import jws from 'jws'
import Bluebird from 'bluebird'

import {mockModule} from '../../helpers/module-mock.mts'
import {startUnit, type Running} from '../../helpers/zebrunner.mts'

describe('zebrunner: auth-mock', function() {
  var auth: Running

  before(async function() {
    var restores = [
      mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
    , mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
        checkUserBeforeLogin: function() {
          return Bluebird.resolve(true)
        }
      }})
    ]
    try {
      auth = await startUnit(new URL('../../../lib/units/auth/mock.js', import.meta.url), {
        secret: 'mock-secret'
      , ssid: 'ssid'
      , appUrl: 'http://stf.example.com/'
      , mock: {useBasicAuth: false, basicAuth: {}}
      })
    }
    finally {
      restores.forEach(function(restore) {
        restore()
      })
    }
  })

  after(function() {
    return auth.close()
  })

  it('should give the app a token that expires within minutes', async function() {
    var page = await fetch(auth.origin + '/auth/mock/')
    var cookies = page.headers.getSetCookie().map(function(cookie) {
      return cookie.split(';')[0]!
    })
    var csrf = cookies.find(function(cookie) {
      return cookie.startsWith('XSRF-TOKEN=')
    })!.slice('XSRF-TOKEN='.length)
    var res = await fetch(auth.origin + '/auth/api/v1/mock', {
      method: 'POST'
    , headers: {
        'content-type': 'application/json'
      , accept: 'application/json'
      , cookie: cookies.join('; ')
      , 'x-xsrf-token': decodeURIComponent(csrf)
      }
    , body: JSON.stringify({name: 'alice', email: 'alice@example.com'})
    })
    expect(res.status).to.equal(200)
    var redirect = new URL((await res.json() as {redirect: string}).redirect)
    var exp = Number(jws.decode(redirect.searchParams.get('jwt')!)!.header.exp)
    expect(exp).to.be.above(Date.now())
    expect(exp).to.be.at.most(Date.now() + 2 * 60 * 1000)
  })
})
