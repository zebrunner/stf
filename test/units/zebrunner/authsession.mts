// Fork (Zebrunner): server-side sessions, lib/util/authsession.ts
import {expect} from 'chai'
import cookieSession from 'cookie-session'
import express from 'express'

import {importFresh, mockModule} from '../../helpers/module-mock.mts'
import {listen, sessionCookie, type Running} from '../../helpers/zebrunner.mts'

var SECRET = 'authsession-secret'

interface Session {
  id: string
  email: string
  expiresAt: number
}

var sessions = new Map<string, Session>()
var deleted: string[] = []

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  saveSession: function(session: Session) {
    sessions.set(session.id, session)
    return Promise.resolve()
  }
, loadSession: function(id: string) {
    return Promise.resolve(sessions.get(id) || null)
  }
, deleteSession: function(id: string) {
    deleted.push(id)
    sessions.delete(id)
    return Promise.resolve({deleted: 1})
  }
}})
var authsession = (await importFresh(
  new URL('../../../lib/util/authsession.js', import.meta.url)
)).default
restoreDbApi()
restoreDb()

function jwt(sid: string, expiresAt = Date.now() + 3600000) {
  return {email: 'user@example.com', name: 'User', sid: sid, expiresAt: expiresAt}
}

describe('zebrunner: authsession', function() {
  var server: Running

  before(async function() {
    var app = express()
    app.use(cookieSession({name: 'ssid', keys: [SECRET]}))
    app.use(authsession.middleware())
    app.get('/whoami', function(req, res) {
      res.json({email: req.session?.jwt?.email || null})
    })
    app.get('/signin', function(req, res, next) {
      req.session!.jwt = {email: 'new@example.com', name: 'New'}
      authsession.establish(req)
        .then(function() {
          res.json(req.session!.jwt)
        })
        .catch(next)
    })
    server = await listen(app)
  })

  after(async function() {
    await server.close()
  })

  beforeEach(function() {
    sessions.clear()
    deleted.length = 0
  })

  async function whoami(session: object) {
    var cookie = await sessionCookie(SECRET, session)
    return (await (await fetch(server.origin + '/whoami', {headers: {cookie: cookie}})).json() as {
      email: string | null
    }).email
  }

  it('should keep the user of an active session', async function() {
    sessions.set('active', {id: 'active', email: 'user@example.com', expiresAt: Date.now() + 60000})
    expect(await whoami({jwt: jwt('active')})).to.equal('user@example.com')
  })

  it('should drop the user of a session that ended with a logout', async function() {
    expect(await whoami({jwt: jwt('gone')})).to.equal(null)
  })

  it('should drop the user of an expired session and delete it', async function() {
    sessions.set('old', {id: 'old', email: 'user@example.com', expiresAt: Date.now() - 1000})
    expect(await whoami({jwt: jwt('old')})).to.equal(null)
    expect(deleted).to.eql(['old'])
  })

  it('should drop the user of an expired cookie, without the database', async function() {
    sessions.set('late', {id: 'late', email: 'user@example.com', expiresAt: Date.now() + 60000})
    expect(await whoami({jwt: jwt('late', Date.now() - 1000)})).to.equal(null)
  })

  it('should drop the user of a cookie from before the sessions', async function() {
    expect(await whoami({jwt: {email: 'user@example.com', name: 'User'}})).to.equal(null)
  })

  it('should start a session with an expiry and an httpOnly cookie', async function() {
    var res = await fetch(server.origin + '/signin')
    var body = await res.json() as {sid: string, expiresAt: number}
    expect(sessions.get(body.sid)!.email).to.equal('new@example.com')
    expect(body.expiresAt).to.be.closeTo(Date.now() + 24 * 3600000, 60000)
    var cookies = res.headers.getSetCookie().join('\n')
    expect(cookies).to.match(/ssid=[^;]+;.*httponly/i)
    expect(cookies).to.match(/samesite=lax/i)
  })

  it('should end the session at logout', async function() {
    sessions.set('mine', {id: 'mine', email: 'user@example.com', expiresAt: Date.now() + 60000})
    var cookie = await sessionCookie(SECRET, {jwt: jwt('mine')})
    var res = await fetch(server.origin + '/app/api/v1/logout', {
      method: 'POST'
    , headers: {cookie: cookie}
    })
    expect(res.status).to.equal(200)
    expect(await res.json()).to.eql({success: true})
    expect(deleted).to.eql(['mine'])
    expect(res.headers.getSetCookie().join('\n')).to.match(/ssid=;/)
  })

  it('should take the lifetime of the sessions from STF_SESSION_TTL_SECONDS', function() {
    var saved = process.env.STF_SESSION_TTL_SECONDS
    process.env.STF_SESSION_TTL_SECONDS = '600'
    try {
      expect(authsession.ttlSeconds()).to.equal(600)
      process.env.STF_SESSION_TTL_SECONDS = 'nonsense'
      expect(authsession.ttlSeconds()).to.equal(24 * 3600)
    }
    finally {
      if (typeof saved === 'undefined') {
        delete process.env.STF_SESSION_TTL_SECONDS
      }
      else {
        process.env.STF_SESSION_TTL_SECONDS = saved
      }
    }
  })

  describe('socketMiddleware', function() {
    function connect(session: {jwt?: object}): Promise<{session: {jwt?: object}}> {
      var request = {session: session, headers: {}}
      return new Promise(function(resolve, reject) {
        authsession.socketMiddleware({request: request}, function(err?: Error) {
          if (err) {
            reject(err)
          }
          else {
            resolve(request)
          }
        })
      })
    }

    it('should keep the user of an active session', async function() {
      var expiresAt = Date.now() + 60000
      sessions.set('socket', {id: 'socket', email: 'user@example.com', expiresAt: expiresAt})
      expect((await connect({jwt: jwt('socket')})).session.jwt).to.be.an('object')
    })

    it('should drop the user of an ended session', async function() {
      expect((await connect({jwt: jwt('ended')})).session).to.not.have.property('jwt')
    })
  })
})
