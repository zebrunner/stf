// Fork (Zebrunner): the OAuth2 sign-in accepts the verified emails of its domain only and hands out a
// short token, lib/units/auth/oauth2/index.ts and lib/util/zebrunner-signin.ts
import {expect} from 'chai'
import express from 'express'
import jws from 'jws'

import signin from '../../../lib/util/zebrunner-signin.js'
import {mockModule} from '../../helpers/module-mock.mts'
import {listen, startUnit, type Running} from '../../helpers/zebrunner.mts'

describe('zebrunner: auth-oauth2', function() {
  var provider: Running, auth: Running, profile: Record<string, unknown>

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
    var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
    try {
      auth = await startUnit(new URL('../../../lib/units/auth/oauth2/index.js', import.meta.url), {
        secret: 'oauth-secret'
      , ssid: 'ssid'
      , appUrl: 'http://stf.example.com/'
      , domain: 'example.com'
      , oauth: {
          authorizationURL: provider.origin + '/authorize'
        , tokenURL: provider.origin + '/token'
        , userinfoURL: provider.origin + '/userinfo'
        , clientID: 'client'
        , clientSecret: 'client-secret'
        , callbackURL: 'http://stf.example.com/auth/oauth/callback'
        , scope: ['openid', 'email']
        }
      })
    }
    finally {
      restoreDb()
    }
  })

  after(async function() {
    await auth.close()
    await provider.close()
  })

  function callback() {
    return fetch(auth.origin + '/auth/oauth/callback?code=code', {redirect: 'manual'})
  }

  it('should give the app a token that expires within minutes', async function() {
    profile = {email: 'alice@example.com', email_verified: true}
    var res = await callback()
    expect(res.status).to.equal(302)
    var redirect = new URL(res.headers.get('location')!)
    expect(redirect.origin).to.equal('http://stf.example.com')
    var token = jws.decode(redirect.searchParams.get('jwt')!)!
    expect(JSON.parse(String(token.payload))).to.eql({email: 'alice@example.com', name: 'alice'})
    var exp = Number(token.header.exp)
    expect(exp).to.be.above(Date.now())
    expect(exp).to.be.at.most(Date.now() + 2 * 60 * 1000)
  })

  it('should accept an email of the domain in any case without email_verified', async function() {
    profile = {email: 'Bob@Example.COM'}
    expect((await callback()).status).to.equal(302)
  })

  ;[
    {email: 'mallory@evil-example.com', email_verified: true}
  , {email: 'mallory@example.com.evil.org', email_verified: true}
  , {email: 'admin@example.com', email_verified: false}
  , {email: 'admin@example.com', email_verified: 'false'}
  , {email_verified: true}
  ].forEach(function(rejected) {
    it(`should reject ${JSON.stringify(rejected)}`, async function() {
      profile = rejected
      var res = await callback()
      expect(res.status).to.equal(200)
      expect(res.headers.get('location')).to.equal(null)
      expect(await res.text()).to.include('<body>Missing or rejected email address')
    })
  })

  it('should check the domain of an email', function() {
    expect(signin.isEmailAllowed('a@example.com', '@Example.com')).to.equal(true)
    expect(signin.isEmailAllowed('a@sub.example.com', 'example.com')).to.equal(false)
    expect(signin.isEmailAllowed('a@any.org', '')).to.equal(true)
    expect(signin.isEmailAllowed('example.com', '')).to.equal(false)
    expect(signin.isEmailAllowed(null, 'example.com')).to.equal(false)
  })
})
