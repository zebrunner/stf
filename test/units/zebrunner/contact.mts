// Fork (Zebrunner): GET /auth/contact of the sign-ins tells the admin to the signed-in users only,
// lib/util/zebrunner-contact.ts
import {expect} from 'chai'
import express from 'express'

import zebrunnerSession from '../../../lib/util/zebrunner-session.js'
import logger from '../../../lib/util/logger.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'
import {listen, sessionCookie, type Running} from '../../helpers/zebrunner.mts'

var SECRET = 'contact-secret'
var ADMIN = {email: 'admin@example.com', name: 'The Admin'}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  getRootGroup: function() {
    return Promise.resolve({owner: ADMIN})
  }
, loadSession: function(id: string) {
    var active = {id: id, email: 'user@example.com', expiresAt: Date.now() + 60000}
    return Promise.resolve(id === 'active' ? active : null)
  }
}})
// fresh copies: the ones another test file loaded keep the db mock of that file
var authsessionUrl = new URL('../../../lib/util/authsession.js', import.meta.url)
var restoreAuthsession = mockModule(authsessionUrl, {...await importFresh(authsessionUrl)})
var contactUrl = new URL('../../../lib/util/zebrunner-contact.js', import.meta.url)
var contact = (await importFresh(contactUrl)).default
restoreAuthsession()
restoreDbApi()
restoreDb()

describe('zebrunner: contact of the sign-ins', function() {
  var server: Running

  before(async function() {
    var app = express()
    app.get(
      '/auth/contact'
    , zebrunnerSession.sessionCookie('ssid', SECRET)
    , contact.contact(logger.createLogger('test'))
    )
    server = await listen(app)
  })

  after(function() {
    return server.close()
  })

  afterEach(function() {
    delete process.env.STF_CONTACT_EMAIL
  })

  async function ask(session?: object) {
    var headers: Record<string, string> = {}
    if (session) {
      headers.cookie = await sessionCookie(SECRET, session)
    }
    var res = await fetch(server.origin + '/auth/contact', {headers: headers})
    expect(res.status).to.equal(200)
    return await res.json() as {success: boolean, contact: Record<string, string>}
  }

  it('should tell nothing of the admin before a sign-in', async function() {
    expect(await ask()).to.eql({success: true, contact: {}})
  })

  it('should tell nothing to a session that ended', async function() {
    var jwt = {email: 'user@example.com', sid: 'gone', expiresAt: Date.now() + 60000}
    expect(await ask({jwt: jwt})).to.eql({success: true, contact: {}})
  })

  it('should tell a signed-in user the email of the admin, not its name', async function() {
    var jwt = {email: 'user@example.com', sid: 'active', expiresAt: Date.now() + 60000}
    expect(await ask({jwt: jwt})).to.eql({success: true, contact: {email: 'admin@example.com'}})
  })

  it('should tell everyone the address of STF_CONTACT_EMAIL', async function() {
    process.env.STF_CONTACT_EMAIL = ' support@example.com '
    expect(await ask()).to.eql({success: true, contact: {email: 'support@example.com'}})
  })
})
