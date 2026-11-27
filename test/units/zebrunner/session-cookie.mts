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

  it('should tell the https public URLs', function() {
    expect(zebrunnerSession.isHttpsUrl('https://mcloud.example.com/auth/mock/')).to.equal(true)
    expect(zebrunnerSession.isHttpsUrl(' HTTPS://mcloud.example.com')).to.equal(true)
    expect(zebrunnerSession.isHttpsUrl('http://localhost:8082/stf')).to.equal(false)
    expect(zebrunnerSession.isHttpsUrl('')).to.equal(false)
  })

  it('should trust X-Forwarded-For of a proxy of a private network, one hop only', function() {
    var proxies = ['127.0.0.1', '172.18.0.5', '10.0.0.2', '192.168.1.9', '::1', '::ffff:172.18.0.5']
    for (var proxy of proxies) {
      expect(zebrunnerSession.trustProxy(proxy, 0), proxy).to.equal(true)
      expect(zebrunnerSession.trustProxy(proxy, 1), proxy + ' second hop').to.equal(false)
    }
    expect(zebrunnerSession.trustProxy('203.0.113.7', 0)).to.equal(false)
  })

  it('should tell the https requests', function() {
    expect(zebrunnerSession.isHttps({headers: {'x-forwarded-proto': 'https'}})).to.equal(true)
    expect(zebrunnerSession.isHttps({headers: {}, socket: {encrypted: true}})).to.equal(true)
    var several = {headers: {'x-forwarded-proto': ['http', 'https']}}
    expect(zebrunnerSession.isHttps(several)).to.equal(false)
    expect(zebrunnerSession.isHttps({headers: {}})).to.equal(false)
  })
})

describe('zebrunner: cookies of an https public URL', function() {
  var server: http.Server, port: number, ip: string

  before(async function() {
    var app = express()
    app.set('trust proxy', zebrunnerSession.trustProxy)
    app.use(zebrunnerSession.sessionCookie('ssid', 'secret', 'https://mcloud.example.com/stf'))
    app.get('/', function(req, res) {
      req.session!.jwt = {email: 'user@example.com'}
      ip = req.ip!
      res.cookie('XSRF-TOKEN', 'token', {
        secure: zebrunnerSession.isSecure(req, 'https://mcloud.example.com/stf')
      })
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
    return res.headers.getSetCookie()
  }

  it('should set Secure cookies whatever X-Forwarded-Proto says', async function() {
    for (var headers of [{}, {'X-Forwarded-Proto': 'http'}, {'X-Forwarded-Proto': 'https'}]) {
      var all = await cookies(headers)
      var session = all.find(function(cookie) {
        return cookie.startsWith('ssid=')
      })
      var xsrf = all.find(function(cookie) {
        return cookie.startsWith('XSRF-TOKEN=')
      })
      expect(session, JSON.stringify(headers)).to.match(/; secure/i)
      expect(session, JSON.stringify(headers)).to.match(/; httponly/i)
      expect(xsrf, JSON.stringify(headers)).to.match(/; secure/i)
      // the UI reads it
      expect(xsrf, JSON.stringify(headers)).to.not.match(/; httponly/i)
    }
  })

  it('should take the address of the proxy hop, not the one the client wrote', async function() {
    await cookies({'X-Forwarded-For': '198.51.100.1, 203.0.113.9'})
    expect(ip).to.equal('203.0.113.9')
    await cookies()
    expect(ip).to.equal('127.0.0.1')
  })
})

describe('zebrunner: XSRF-TOKEN cookie', function() {
  function cookie(publicUrl: string | undefined, headers: Record<string, string>) {
    type Options = {secure?: boolean, sameSite?: string}
    var set: {options?: Options} = {}
    var req = {headers: headers, csrfToken: () => 'token'}
    var res = {
      cookie: function(name: string, value: string, options: Options) {
        expect(name).to.equal('XSRF-TOKEN')
        expect(value).to.equal('token')
        set.options = options
      }
    }
    var middleware = zebrunnerSession.xsrfCookie(publicUrl) as unknown as
      (req: object, res: object, next: () => void) => void
    middleware(req, res, function() {})
    return set.options!
  }

  it('should be Secure for an https public URL or an https request only', function() {
    expect(cookie('https://mcloud.example.com/', {'x-forwarded-proto': 'http'}).secure).to.equal(true)
    expect(cookie('http://localhost:8082/', {'x-forwarded-proto': 'https'}).secure).to.equal(true)
    expect(cookie('http://localhost:8082/', {}).secure).to.equal(false)
    expect(cookie('', {}).sameSite).to.equal('lax')
  })
})
