// Fork (Zebrunner): sign-in through the IAM service of Zebrunner, lib/units/auth/zebrunner.ts
import {expect} from 'chai'
import express from 'express'

import jwtutil from '../../../lib/util/jwtutil.js'
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
    , appUrl: 'http://stf.example.com/'
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
    expect(redirect.origin + redirect.pathname).to.equal('http://stf.example.com/stf')
    expect(jwtutil.decode(redirect.searchParams.get('jwt')!, SECRET)).to.eql({
      email: 'jdoe@example.com'
    , name: 'jdoe'
    })
    expect(logins).to.eql([{username: 'jdoe', password: 'right'}])
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
