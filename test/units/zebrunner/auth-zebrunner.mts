// Fork (Zebrunner): sign-in through the IAM service of Zebrunner, lib/units/auth/zebrunner.ts
import {expect} from 'chai'
import express from 'express'

import jws from 'jws'

import jwtutil from '../../../lib/util/jwtutil.js'
import logger from '../../../lib/util/logger.js'
import {listen, startUnit, type Running} from '../../helpers/zebrunner.mts'

var SECRET = 'auth-test-secret'

interface Session {
  cookie: string
  csrf: string
}

function cookies(res: Response) {
  return res.headers.getSetCookie().map(function(cookie) {
    return cookie.split(';')[0]!
  })
}

describe('zebrunner: auth-zebrunner', function() {
  var iam: Running, auth: Running
  var logins: unknown[] = []
  var users: Record<string, {username: string, email?: string | null}> = {}

  before(async function() {
    var app = express()
    app.use(express.json())
    app.post('/api/iam/v1/auth/login', function(req, res) {
      logins.push(req.body)
      if (req.body.password === 'deactivated') {
        res.status(401).json({message: 'unauthorized'})
        return
      }
      if (req.body.password !== 'right') {
        res.status(404).json({message: 'not found'})
        return
      }
      res.json({
        userId: req.body.username === 'noemail' ? 8 : 7
      , authToken: 'token-' + req.body.username
      })
    })
    app.get('/api/iam/v1/users/:id', function(req, res) {
      var user = users[req.params.id]
      if (!user || !/^Bearer token-/.test(req.headers.authorization || '')) {
        res.status(401).end()
        return
      }
      res.json(user)
    })
    app.post('/broken/login', function(req, res) {
      res.status(503).end()
    })
    iam = await listen(app)
    users = {
      '7': {username: 'jdoe', email: 'jdoe@example.com'}
    , '8': {username: 'noemail', email: null}
    }
    auth = await startUnit(new URL('../../../lib/units/auth/zebrunner.js', import.meta.url), {
      secret: SECRET
    , ssid: 'ssid'
      // --app-url of the docker-compose.yml of mcloud: ${STF_URL}/stf
    , appUrl: 'http://stf.example.com/stf'
    , zebrunner: {
        loginURL: iam.origin + '/api/iam/v1/auth/login'
      , userinfoURL: iam.origin + '/api/iam/v1/users'
      }
    })
  })

  after(async function() {
    await auth.close()
    await iam.close()
  })

  beforeEach(function() {
    logins.length = 0
  })

  async function session(): Promise<Session> {
    var res = await fetch(auth.origin + '/auth/zebrunner/')
    expect(res.status).to.equal(200)
    var all = cookies(res)
    var csrf = all.find(function(cookie) {
      return cookie.startsWith('XSRF-TOKEN=')
    })!.slice('XSRF-TOKEN='.length)
    return {cookie: all.join('; '), csrf: decodeURIComponent(csrf)}
  }

  async function signIn(body: object, current?: Session) {
    var used = current || await session()
    return fetch(auth.origin + '/auth/api/v1/zebrunner', {
      method: 'POST'
    , headers: {
        'content-type': 'application/json'
      , cookie: used.cookie
      , 'x-xsrf-token': used.csrf
      }
    , body: JSON.stringify(body)
    })
  }

  it('should redirect to the app with a token of the Zebrunner user', async function() {
    var res = await signIn({username: 'jdoe', password: 'right'})
    expect(res.status).to.equal(200)
    var body = await res.json() as {success: boolean, redirect: string}
    expect(body.success).to.equal(true)
    var redirect = new URL(body.redirect)
    // --app-url as is, as the other auth units: it was followed by stf, /stfstf?jwt=...
    expect(redirect.origin + redirect.pathname).to.equal('http://stf.example.com/stf')
    expect(jwtutil.decode(redirect.searchParams.get('jwt')!, SECRET)).to.eql({
      email: 'jdoe@example.com'
    , name: 'jdoe'
    })
    expect(logins).to.eql([{username: 'jdoe', password: 'right'}])
  })

  it('should give the app a token that expires within minutes', async function() {
    var res = await signIn({username: 'jdoe', password: 'right'})
    var token = new URL((await res.json() as {redirect: string}).redirect).searchParams.get('jwt')!
    var exp = Number(jws.decode(token)!.header.exp)
    expect(exp).to.be.above(Date.now())
    expect(exp).to.be.at.most(Date.now() + 2 * 60 * 1000)
  })

  it('should make up an email for a user without one', async function() {
    var res = await signIn({username: 'noemail', password: 'right'})
    var body = await res.json() as {redirect: string}
    var token = new URL(body.redirect).searchParams.get('jwt')!
    expect(jwtutil.decode(token, SECRET)).to.eql({
      email: 'noemail@fakedomain.com'
    , name: 'noemail'
    })
  })

  it('should answer invalid credentials when Zebrunner does not know them', async function() {
    var res = await signIn({username: 'jdoe', password: 'wrong'})
    expect(res.status).to.equal(400)
    expect(await res.json()).to.eql({success: false, error: 'InvalidCredentialsError'})
  })

  it('should lock a user out after five failed sign-ins', async function() {
    for (var i = 0; i < 5; i++) {
      expect((await signIn({username: 'brute', password: 'wrong'})).status).to.equal(400)
    }
    expect((await signIn({username: 'brute', password: 'right'})).status).to.equal(429)
    expect((await signIn({username: 'jdoe', password: 'right'})).status).to.equal(200)
  })

  it('should answer invalid credentials when Zebrunner refuses them with 401', async function() {
    var res = await signIn({username: 'jdoe', password: 'deactivated'})
    expect(res.status).to.equal(400)
    expect(await res.json()).to.eql({success: false, error: 'InvalidCredentialsError'})
  })

  describe('with an unavailable IAM', function() {
    var broken: Running
    var messages: string[] = []
    function onEntry(entry: {message: string}) {
      messages.push(entry.message)
    }

    before(async function() {
      broken = await startUnit(new URL('../../../lib/units/auth/zebrunner.js', import.meta.url), {
        secret: SECRET
      , ssid: 'ssid'
      , appUrl: 'http://stf.example.com/'
      , zebrunner: {
          loginURL: iam.origin + '/broken/login'
        , userinfoURL: iam.origin + '/api/iam/v1/users'
        }
      })
      logger.on('entry', onEntry)
    })

    after(async function() {
      logger.removeListener('entry', onEntry)
      await broken.close()
    })

    async function signInBroken(body: object) {
      var res = await fetch(broken.origin + '/auth/zebrunner/')
      var all = cookies(res)
      var csrf = all.find(function(cookie) {
        return cookie.startsWith('XSRF-TOKEN=')
      })!.slice('XSRF-TOKEN='.length)
      return fetch(broken.origin + '/auth/api/v1/zebrunner', {
        method: 'POST'
      , headers: {
          'content-type': 'application/json'
        , cookie: all.join('; ')
        , 'x-xsrf-token': decodeURIComponent(csrf)
        }
      , body: JSON.stringify(body)
      })
    }

    it('should answer a server error without logging the credentials', async function() {
      messages.length = 0
      var res = await signInBroken({username: 'jdoe', password: 'TopSecret-123'})
      expect(res.status).to.equal(502)
      expect(await res.json()).to.eql({success: false, error: 'ServerError'})
      expect(messages.join('\n')).to.contain('Zebrunner IAM failed to sign in')
      expect(messages.join('\n')).not.to.contain('TopSecret-123')
    })

    it('should not lock a user out while IAM is unavailable', async function() {
      for (var i = 0; i < 6; i++) {
        expect((await signInBroken({username: 'outage', password: 'x'})).status).to.equal(502)
      }
    })
  })

  it('should refuse a sign-in without the CSRF token', async function() {
    var current = await session()
    var res = await signIn(
      {username: 'jdoe', password: 'right'}
    , {cookie: current.cookie, csrf: 'x'}
    )
    expect(res.status).to.equal(403)
    expect(logins).to.eql([])
  })
})
