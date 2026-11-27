// Fork (Zebrunner): the OAuth2 sign-in accepts the verified emails of its domain only, checks the state
// parameter with a cookie of its own and hands out a short token, lib/units/auth/oauth2/index.ts and
// lib/util/zebrunner-signin.ts
import {expect} from 'chai'
import express from 'express'
import jws from 'jws'

import signin from '../../../lib/util/zebrunner-signin.js'
import {mockModule} from '../../helpers/module-mock.mts'
import {listen, startUnit, type Running} from '../../helpers/zebrunner.mts'

describe('zebrunner: auth-oauth2', function() {
  var provider: Running, auth: Running, lenient: Running, stateful: Running
    , profile: Record<string, unknown>

  function start(extra: Record<string, unknown>, oauth: Record<string, unknown> = {}) {
    var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
    var unit = new URL('../../../lib/units/auth/oauth2/index.js', import.meta.url)
    return startUnit(unit, Object.assign({
      secret: 'oauth-secret'
    , ssid: 'ssid'
    , appUrl: 'http://stf.example.com/'
    , domain: 'example.com'
    , oauth: Object.assign({
        authorizationURL: provider.origin + '/authorize'
      , tokenURL: provider.origin + '/token'
      , userinfoURL: provider.origin + '/userinfo'
      , clientID: 'client'
      , clientSecret: 'client-secret'
      , callbackURL: 'http://stf.example.com/auth/oauth/callback'
      , scope: ['openid', 'email']
      }, oauth)
    }, extra)).finally(restoreDb)
  }

  before(async function() {
    // the provider: any code is exchanged for a token, the user info is the profile of the test
    var app = express()
    app.post('/token', function(req, res) {
      res.json({access_token: 'access', token_type: 'Bearer'})
    })
    app.get('/userinfo', function(req, res) {
      res.json(profile)
    })
    provider = await listen(app)
    auth = await start({})
    lenient = await start({allowMissingEmailVerified: true})
    stateful = await start({}, {state: true})
  })

  after(async function() {
    await auth.close()
    await lenient.close()
    await stateful.close()
    await provider.close()
  })

  function signIn(unit = auth) {
    return fetch(unit.origin + '/auth/oauth/callback?code=code', {redirect: 'manual'})
  }

  function cookies(res: Response) {
    return res.headers.getSetCookie().map(function(cookie) {
      return cookie.split(';')[0]
    }).join('; ')
  }

  it('should give the app a token that expires within minutes', async function() {
    profile = {email: 'alice@example.com', email_verified: true}
    var res = await signIn()
    expect(res.status).to.equal(302)
    var redirect = new URL(res.headers.get('location')!)
    expect(redirect.origin).to.equal('http://stf.example.com')
    var token = jws.decode(redirect.searchParams.get('jwt')!)!
    expect(JSON.parse(String(token.payload))).to.eql({email: 'alice@example.com', name: 'alice'})
    var exp = Number(token.header.exp)
    expect(exp).to.be.above(Date.now())
    expect(exp).to.be.at.most(Date.now() + 2 * 60 * 1000)
  })

  it('should accept an email of the domain in any case', async function() {
    profile = {email: 'Bob@Example.COM', email_verified: true}
    expect((await signIn()).status).to.equal(302)
  })

  ;[
    {email: 'carol@example.com', email_verified: 'true'}
  , {email: 'carol@example.com', email_verified: 'TRUE'}
  , {email: 'carol@example.com', verified_email: true}
  ].forEach(function(accepted) {
    it(`should accept ${JSON.stringify(accepted)}`, async function() {
      profile = accepted
      expect((await signIn()).status).to.equal(302)
    })
  })

  ;[
    {email: 'mallory@evil-example.com', email_verified: true}
  , {email: 'mallory@example.com.evil.org', email_verified: true}
  , {email: 'admin@example.com', email_verified: false}
  , {email: 'admin@example.com', email_verified: 'false'}
  , {email: 'admin@example.com'}
  , {email: 'admin@example.com', email_verified: null}
  , {email: 'admin@example.com', email_verified: 1}
  , {email: 'admin@example.com', email_verified: false, verified_email: true}
  , {email_verified: true}
  ].forEach(function(rejected) {
    it(`should reject ${JSON.stringify(rejected)}`, async function() {
      profile = rejected
      var res = await signIn()
      expect(res.status).to.equal(200)
      expect(res.headers.get('location')).to.equal(null)
      expect(await res.text()).to.include('<body>Missing or rejected email address')
    })
  })

  it('should take a profile without email_verified with the option only', async function() {
    profile = {email: 'dave@example.com'}
    expect((await signIn(lenient)).status).to.equal(302)
    profile = {email: 'dave@example.com', email_verified: false}
    expect((await signIn(lenient)).status).to.equal(200)
    profile = {email: 'dave@other.org'}
    expect((await signIn(lenient)).status).to.equal(200)
  })

  describe('state', function() {
    async function begin() {
      var res = await fetch(stateful.origin + '/auth/oauth/', {redirect: 'manual'})
      expect(res.status).to.equal(302)
      var location = new URL(res.headers.get('location')!)
      expect(location.origin + location.pathname).to.equal(provider.origin + '/authorize')
      return {state: location.searchParams.get('state')!, res: res}
    }

    it('should send a state and keep it in an HttpOnly cookie of the sign-in', async function() {
      var started = await begin()
      expect(started.state).to.have.length.above(16)
      var setCookie = started.res.headers.getSetCookie()
      var cookie = setCookie.find(function(value) {
        return value.startsWith('ssid-oauth2=')
      })!
      expect(cookie).to.match(/httponly/i)
      expect(cookie).to.match(/samesite=lax/i)
      expect(cookie).to.match(/expires=/i)
      expect(cookie).to.not.include(started.state)
      expect(setCookie.join('\n')).to.not.match(/(^|\n)ssid=/)
    })

    it('should sign in with the state of its cookie and drop it', async function() {
      var started = await begin()
      profile = {email: 'erin@example.com', email_verified: true}
      var res = await fetch(stateful.origin + '/auth/oauth/callback?code=code&state=' +
        encodeURIComponent(started.state)
      , {redirect: 'manual', headers: {cookie: cookies(started.res)}})
      expect(res.status).to.equal(302)
      expect(new URL(res.headers.get('location')!).searchParams.get('jwt')).to.be.a('string')
      expect(res.headers.getSetCookie().join('\n')).to.match(/ssid-oauth2=;/)
    })

    it('should refuse a callback without the cookie or with another state', async function() {
      var started = await begin()
      profile = {email: 'erin@example.com', email_verified: true}
      var without = await fetch(stateful.origin + '/auth/oauth/callback?code=code&state=' +
        encodeURIComponent(started.state), {redirect: 'manual'})
      expect(without.status).to.equal(400)
      expect(without.headers.get('location')).to.equal(null)
      var other = await fetch(stateful.origin + '/auth/oauth/callback?code=code&state=other',
        {redirect: 'manual', headers: {cookie: cookies(started.res)}})
      expect(other.status).to.equal(400)
      var none = await fetch(stateful.origin + '/auth/oauth/callback?code=code',
        {redirect: 'manual', headers: {cookie: cookies(started.res)}})
      expect(none.status).to.equal(400)
    })

    it('should send the user back to the sign-in when the provider refuses', async function() {
      var res = await fetch(auth.origin + '/auth/oauth/callback?error=access_denied',
        {redirect: 'manual'})
      expect(res.status).to.equal(302)
      expect(res.headers.get('location')).to.equal('/auth/oauth/')
    })
  })

  it('should tell the admin to no one who is not signed in', async function() {
    var res = await fetch(auth.origin + '/auth/contact')
    expect(res.status).to.equal(200)
    expect(await res.json()).to.eql({success: true, contact: {}})
  })

  it('should check the domain of an email', function() {
    expect(signin.isEmailAllowed('a@example.com', '@Example.com')).to.equal(true)
    expect(signin.isEmailAllowed('a@sub.example.com', 'example.com')).to.equal(false)
    expect(signin.isEmailAllowed('a@any.org', '')).to.equal(true)
    expect(signin.isEmailAllowed('example.com', '')).to.equal(false)
    expect(signin.isEmailAllowed(null, 'example.com')).to.equal(false)
  })

  it('should take a verified email, a missing verification with allowMissing only', function() {
    expect(signin.isEmailVerified({email_verified: true})).to.equal(true)
    expect(signin.isEmailVerified({})).to.equal(false)
    expect(signin.isEmailVerified({}, true)).to.equal(true)
    expect(signin.isEmailVerified({email_verified: false}, true)).to.equal(false)
    expect(signin.isEmailVerified({email_verified: 'no'}, true)).to.equal(false)
  })
})
