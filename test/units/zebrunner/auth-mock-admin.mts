// Fork (Zebrunner): an admin of STF signs in to the mock sign-in with the admin credentials only,
// lib/units/auth/mock.ts: the credentials of the users do not make an admin of whoever knows the
// name and the email of one
import {expect} from 'chai'
import Bluebird from 'bluebird'

import {mockModule} from '../../helpers/module-mock.mts'
import {startUnit, type Running} from '../../helpers/zebrunner.mts'

var USERS = {username: 'mcloud', password: 'users-password'}
var ADMIN = {username: 'mcloud-admin', password: 'admin-password'}
var PRIVILEGES: Record<string, string> = {
  'admin@example.com': 'admin'
, 'alice@example.com': 'user'
}

function basic(credentials: {username: string, password: string}) {
  var pair = credentials.username + ':' + credentials.password
  return 'Basic ' + Buffer.from(pair).toString('base64')
}

// signIn <unit> <credentials> <email>: the status of the sign-in of the name before the @ of the email
async function signIn(unit: Running, authorization: string, email: string) {
  var page = await fetch(unit.origin + '/auth/mock/', {headers: {authorization: authorization}})
  if (page.status !== 200) {
    return page.status
  }
  var cookies = page.headers.getSetCookie().map(function(cookie) {
    return cookie.split(';')[0]!
  })
  var csrf = cookies.find(function(cookie) {
    return cookie.startsWith('XSRF-TOKEN=')
  })!.slice('XSRF-TOKEN='.length)
  var res = await fetch(unit.origin + '/auth/api/v1/mock', {
    method: 'POST'
  , headers: {
      'content-type': 'application/json'
    , accept: 'application/json'
    , authorization: authorization
    , cookie: cookies.join('; ')
    , 'x-xsrf-token': decodeURIComponent(csrf)
    }
  , body: JSON.stringify({name: email.split('@')[0], email: email})
  })
  return res.status
}

async function start(adminBasicAuth?: {username: string, password: string}) {
  var restores = [
    mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
  , mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
      checkUserBeforeLogin: function() {
        return Bluebird.resolve(true)
      }
    , loadUser: function(email: string) {
        var privilege = PRIVILEGES[email]
        return Bluebird.resolve(privilege ? {email: email, privilege: privilege} : null)
      }
    }})
  ]
  try {
    return await startUnit(new URL('../../../lib/units/auth/mock.js', import.meta.url), {
      secret: 'mock-secret'
    , ssid: 'ssid'
    , appUrl: 'http://stf.example.com/'
    , mock: {useBasicAuth: true, basicAuth: USERS, adminBasicAuth: adminBasicAuth}
    })
  }
  finally {
    restores.forEach(function(restore) {
      restore()
    })
  }
}

describe('zebrunner: auth-mock admin credentials', function() {
  describe('with the admin credentials set', function() {
    var auth: Running

    before(async function() {
      auth = await start(ADMIN)
    })

    after(function() {
      return auth.close()
    })

    it('should sign a user in with the credentials of the users', async function() {
      expect(await signIn(auth, basic(USERS), 'alice@example.com')).to.equal(200)
    })

    it('should sign a new user in with the credentials of the users', async function() {
      expect(await signIn(auth, basic(USERS), 'bob@example.com')).to.equal(200)
    })

    it('should refuse an admin with the credentials of the users', async function() {
      expect(await signIn(auth, basic(USERS), 'admin@example.com')).to.equal(400)
    })

    it('should sign an admin in with the admin credentials', async function() {
      expect(await signIn(auth, basic(ADMIN), 'admin@example.com')).to.equal(200)
    })

    it('should sign a user in with the admin credentials too', async function() {
      expect(await signIn(auth, basic(ADMIN), 'alice@example.com')).to.equal(200)
    })

    it('should refuse other credentials', async function() {
      var wrong = basic({username: 'mcloud', password: 'wrong'})
      expect(await signIn(auth, wrong, 'alice@example.com')).to.equal(401)
      expect(await signIn(auth, basic({username: 'mcloud-admin', password: 'users-password'}),
        'admin@example.com')).to.equal(401)
    })
  })

  describe('without the admin credentials', function() {
    var auth: Running

    before(async function() {
      auth = await start()
    })

    after(function() {
      return auth.close()
    })

    it('should sign an admin in with the credentials of the users, as before', async function() {
      expect(await signIn(auth, basic(USERS), 'admin@example.com')).to.equal(200)
    })
  })
})
