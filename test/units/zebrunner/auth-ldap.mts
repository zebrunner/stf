// Fork (Zebrunner): the LDAP sign-in limits failed attempts and hands out a short token,
// lib/units/auth/ldap.ts
import {expect} from 'chai'
import jws from 'jws'
import Bluebird from 'bluebird'
import sinon from 'sinon'

import ldaputil from '../../../lib/util/ldaputil.js'
import {mockModule} from '../../helpers/module-mock.mts'
import {startUnit, type Running} from '../../helpers/zebrunner.mts'

interface Session {
  cookie: string
  csrf: string
}

describe('zebrunner: auth-ldap', function() {
  var auth: Running
   , login: sinon.SinonStub

  before(async function() {
    login = sinon.stub(ldaputil, 'login').callsFake(function(options, username, password) {
      if (password !== 'right') {
        return Bluebird.reject(new ldaputil.InvalidCredentialsError(username))
      }
      return Bluebird.resolve({mail: username + '@example.com', uid: username}) as never
    })
    var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
    try {
      auth = await startUnit(new URL('../../../lib/units/auth/ldap.js', import.meta.url), {
        secret: 'ldap-secret'
      , ssid: 'ssid'
      , appUrl: 'http://stf.example.com/'
      , ldap: {username: {field: 'uid'}}
      })
    }
    finally {
      restoreDb()
    }
  })

  after(async function() {
    login.restore()
    await auth.close()
  })

  async function session(): Promise<Session> {
    var res = await fetch(auth.origin + '/auth/ldap/')
    var cookies = res.headers.getSetCookie().map(function(cookie) {
      return cookie.split(';')[0]!
    })
    var csrf = cookies.find(function(cookie) {
      return cookie.startsWith('XSRF-TOKEN=')
    })!.slice('XSRF-TOKEN='.length)
    return {cookie: cookies.join('; '), csrf: decodeURIComponent(csrf)}
  }

  async function signIn(username: string, password: string) {
    var current = await session()
    return fetch(auth.origin + '/auth/api/v1/ldap', {
      method: 'POST'
    , headers: {
        'content-type': 'application/json'
      , accept: 'application/json'
      , cookie: current.cookie
      , 'x-xsrf-token': current.csrf
      }
    , body: JSON.stringify({username: username, password: password})
    })
  }

  it('should give the app a token that expires within minutes', async function() {
    var res = await signIn('alice', 'right')
    expect(res.status).to.equal(200)
    var redirect = new URL((await res.json() as {redirect: string}).redirect)
    var exp = Number(jws.decode(redirect.searchParams.get('jwt')!)!.header.exp)
    expect(exp).to.be.above(Date.now())
    expect(exp).to.be.at.most(Date.now() + 2 * 60 * 1000)
  })

  it('should lock a user out after five failed sign-ins', async function() {
    for (var i = 0; i < 5; i++) {
      var refused = await signIn('mallory', 'wrong')
      expect(refused.status).to.equal(400)
      expect(await refused.json()).to.include({error: 'InvalidCredentialsError'})
    }
    var locked = await signIn('mallory', 'right')
    expect(locked.status).to.equal(429)
    expect(await locked.json()).to.include({error: 'TooManyRequestsError'})
    expect((await signIn('alice', 'right')).status).to.equal(200)
  })
})
