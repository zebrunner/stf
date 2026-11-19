// Fork (Zebrunner): the session cookie of STF, lib/util/zebrunner-session.ts
import http from 'node:http'
import net from 'node:net'

import {expect} from 'chai'
import express from 'express'

import zebrunnerSession from '../../../lib/util/zebrunner-session.js'

describe('zebrunner: session cookie', function() {
  var server: http.Server, port: number

  before(async function() {
    var app = express()
    app.use(zebrunnerSession.sessionCookie('ssid', 'secret'))
    app.get('/', function(req, res) {
      req.session!.jwt = {email: 'user@example.com'}
      res.end('ok')
    })
    server = http.createServer(app)
    await new Promise<void>(function(resolve) {
      server.listen(0, '127.0.0.1', resolve)
    })
    port = (server.address() as net.AddressInfo).port
  })

  after(function(done) {
    server.close(done)
  })

  async function cookies(headers: Record<string, string> = {}) {
    var res = await fetch(`http://127.0.0.1:${port}/`, {headers: headers})
    expect(res.status).to.equal(200)
    return res.headers.getSetCookie().filter(function(cookie) {
      return cookie.startsWith('ssid=')
    })
  }

  it('should set an HttpOnly, SameSite=Lax cookie without Secure over http', async function() {
    var [cookie] = await cookies()
    expect(cookie).to.match(/; httponly/i)
    expect(cookie).to.match(/; samesite=lax/i)
    expect(cookie).to.not.match(/; secure/i)
  })

  it('should set a Secure cookie for the https requests of the proxy', async function() {
    for (var proto of ['https', 'HTTPS', 'https, http']) {
      var [cookie] = await cookies({'X-Forwarded-Proto': proto})
      expect(cookie, proto).to.match(/; secure/i)
      expect(cookie, proto).to.match(/; httponly/i)
    }
    var [plain] = await cookies({'X-Forwarded-Proto': 'http'})
    expect(plain).to.not.match(/; secure/i)
  })

  it('should tell the https requests', function() {
    expect(zebrunnerSession.isHttps({headers: {'x-forwarded-proto': 'https'}})).to.equal(true)
    expect(zebrunnerSession.isHttps({headers: {}, socket: {encrypted: true}})).to.equal(true)
    var several = {headers: {'x-forwarded-proto': ['http', 'https']}}
    expect(zebrunnerSession.isHttps(several)).to.equal(false)
    expect(zebrunnerSession.isHttps({headers: {}})).to.equal(false)
  })
})
