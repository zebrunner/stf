// Fork (Zebrunner): the auth_request of the grid, lib/units/api/controllers/zebrunner-hub-auth.ts, with
// the database stubbed
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

import {expect} from 'chai'
import sinon from 'sinon'

import logger from '../../../lib/util/logger.js'
import jwtutil from '../../../lib/util/jwtutil.js'
import accessTokens from '../../../lib/util/zebrunner-access-tokens.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var yaml = createRequire(import.meta.url)('js-yaml')

interface Reply {
  code: number
  headers: Record<string, string>
}

var dbapi = {
  loadAccessToken: sinon.stub()
, loadUser: sinon.stub()
}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: dbapi})
var controller = await importFresh(
  new URL('../../../lib/units/api/controllers/zebrunner-hub-auth.js', import.meta.url)
)
restoreDbApi()
restoreDb()

var SECRET = 'secret'
var TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd'
var ADMIN_TOKEN = 'f'.repeat(64)
var USER = {email: 'user@example.com', privilege: 'user'}
var ADMIN = {email: 'admin@example.com', privilege: 'admin'}

function stored(email: string) {
  return {id: 'x', jwt: jwtutil.encode({payload: {email: email, name: 'x'}, secret: SECRET})}
}

function basic(name: string, token: string) {
  return 'Basic ' + Buffer.from(name + ':' + token).toString('base64')
}

interface CallOptions {
  scope?: string
  authorization?: string
  session?: object | null
}

// call <options>: the status and the headers the route answers with
function call(options: CallOptions = {}): Promise<Reply> {
  return new Promise<Reply>(function(resolve) {
    var reply: Reply = {code: 200, headers: {}}
    var req = {
      swagger: {params: {scope: {value: options.scope}}}
    , headers: options.authorization ? {authorization: options.authorization} : {}
    , session: options.session
    , options: {secret: SECRET}
    , ip: '10.0.0.9'
    }
    var res = {
      status: function(code: number) {
        reply.code = code
        return res
      }
    , set: function(name: string, value: string) {
        reply.headers[name] = value
        return res
      }
    , end: function() {
        resolve(reply)
        return res
      }
    }
    controller.getHubAuth(req, res)
  })
}

describe('zebrunner: hub auth', function() {
  var logged: string[]

  function onEntry(entry: logger.Entry) {
    logged.push(entry.message)
  }

  beforeEach(function() {
    logged = []
    logger.on('entry', onEntry)
    controller.clearCache()
    dbapi.loadAccessToken.reset()
    dbapi.loadUser.reset()
    dbapi.loadAccessToken.resolves(null)
    dbapi.loadAccessToken.withArgs(TOKEN).resolves(stored(USER.email))
    dbapi.loadAccessToken.withArgs(ADMIN_TOKEN).resolves(stored(ADMIN.email))
    dbapi.loadUser.resolves(null)
    dbapi.loadUser.withArgs(USER.email).resolves(USER)
    dbapi.loadUser.withArgs(ADMIN.email).resolves(ADMIN)
  })

  afterEach(function() {
    logger.removeListener('entry', onEntry)
  })

  it('should be a route without the authentication of the API unit', async function() {
    var swagger = yaml.load(await readFile(
      new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
    , 'utf8'
    )) as {paths: Record<string, Record<string, {operationId?: string, security?: unknown}>>}
    var path = swagger.paths['/zebrunner/hub-auth']!
    expect(path['x-swagger-router-controller']).to.equal('zebrunner-hub-auth')
    expect(path.get!.operationId).to.equal('getHubAuth')
    expect(path.get).to.not.have.property('security')
  })

  it('should take the token of Basic <name>:<token> and of Bearer <token>', function() {
    expect(controller.credentialToken(basic('user@example.com', TOKEN))).to.equal(TOKEN)
    expect(controller.credentialToken(basic('', TOKEN))).to.equal(TOKEN)
    expect(controller.credentialToken('Bearer ' + TOKEN)).to.equal(TOKEN)
    expect(controller.credentialToken('bearer ' + TOKEN)).to.equal(TOKEN)
    expect(controller.credentialToken(basic('user', ''))).to.equal(null)
    var noColon = 'Basic ' + Buffer.from(TOKEN).toString('base64')
    expect(controller.credentialToken(noColon)).to.equal(null)
    expect(controller.credentialToken('Digest x')).to.equal(null)
    expect(controller.credentialToken(null)).to.equal(null)
  })

  it('should let in the user of a token with the user and the token', async function() {
    expect(await call({authorization: basic('anyone', TOKEN)})).to.eql({code: 204, headers: {
      'X-MCloud-User': USER.email
    , 'X-MCloud-Admin': 'false'
    , 'X-MCloud-Token': TOKEN
    }})
    var admin = await call({scope: 'console', authorization: 'Bearer ' + ADMIN_TOKEN})
    expect(admin).to.eql({code: 204, headers: {
      'X-MCloud-User': ADMIN.email
    , 'X-MCloud-Admin': 'true'
    , 'X-MCloud-Token': ADMIN_TOKEN
    }})
  })

  it('should refuse no token, an unknown token and a token of a removed user', async function() {
    expect((await call()).code).to.equal(401)
    expect((await call({authorization: basic('user', 'unknown')})).code).to.equal(401)
    dbapi.loadUser.withArgs(USER.email).resolves(null)
    expect((await call({authorization: basic('user', TOKEN)})).code).to.equal(401)
    expect(logged.join('\n')).to.not.include(TOKEN)
  })

  it('should refuse a token made with another secret', async function() {
    dbapi.loadAccessToken.withArgs(TOKEN).resolves({
      id: 'x'
    , jwt: jwtutil.encode({payload: {email: USER.email, name: 'x'}, secret: 'other'})
    })
    expect((await call({authorization: 'Bearer ' + TOKEN})).code).to.equal(401)
  })

  it('should take a hashed token until its expiry, also when its user is kept', async function() {
    var clock = sinon.useFakeTimers({now: Date.now(), toFake: ['Date']})
    try {
      dbapi.loadAccessToken.withArgs(TOKEN).resolves(
        accessTokens.newDocument(TOKEN, USER.email, 'ci', new Date(Date.now() + 1000))
      )
      expect((await call({authorization: 'Bearer ' + TOKEN})).code).to.equal(204)
      clock.tick(1000)
      expect((await call({authorization: 'Bearer ' + TOKEN})).code).to.equal(401)
      expect(dbapi.loadAccessToken.callCount).to.equal(2)
    }
    finally {
      clock.restore()
    }
  })

  it('should take the session cookie for the console and admin, not for the hub', async function() {
    var session = {jwt: {email: USER.email}}
    expect(await call({scope: 'console', session: session})).to.eql({code: 204, headers: {
      'X-MCloud-User': USER.email
    , 'X-MCloud-Admin': 'false'
    }})
    expect((await call({scope: 'hub', session: session})).code).to.equal(401)
    expect((await call({session: session})).code).to.equal(401)
    expect((await call({scope: 'admin', session: {jwt: {email: ADMIN.email}}})).code).to.equal(204)
    var gone = {jwt: {email: 'gone@example.com'}}
    expect((await call({scope: 'console', session: gone})).code).to.equal(401)
  })

  it('should let only an admin in to the admin routes', async function() {
    expect((await call({scope: 'admin', authorization: basic('user', TOKEN)})).code).to.equal(403)
    expect((await call({scope: 'admin', session: {jwt: {email: USER.email}}})).code).to.equal(403)
    var admin = basic('admin', ADMIN_TOKEN)
    expect((await call({scope: 'admin', authorization: admin})).code).to.equal(204)
  })

  it('should refuse an unknown scope', async function() {
    expect((await call({scope: 'other', authorization: basic('user', TOKEN)})).code).to.equal(400)
  })

  it('should keep the user of a token for a while', async function() {
    var clock = sinon.useFakeTimers({now: Date.now(), toFake: ['Date']})
    try {
      await call({authorization: basic('user', TOKEN)})
      await call({authorization: basic('user', TOKEN)})
      expect(dbapi.loadAccessToken.callCount).to.equal(1)
      clock.tick(controller.CACHE_TTL_MS + 1)
      dbapi.loadAccessToken.withArgs(TOKEN).resolves(null)
      expect((await call({authorization: basic('user', TOKEN)})).code).to.equal(401)
      expect(dbapi.loadAccessToken.callCount).to.equal(2)
    }
    finally {
      clock.restore()
    }
  })

  it('should refuse an unknown token for a while without the database', async function() {
    var clock = sinon.useFakeTimers({now: Date.now(), toFake: ['Date']})
    try {
      expect((await call({authorization: basic('user', 'unknown')})).code).to.equal(401)
      expect((await call({authorization: basic('user', 'unknown')})).code).to.equal(401)
      expect(dbapi.loadAccessToken.callCount).to.equal(1)
      clock.tick(controller.REFUSED_TTL_MS + 1)
      dbapi.loadAccessToken.withArgs('unknown').resolves(stored(USER.email))
      expect((await call({authorization: basic('user', 'unknown')})).code).to.equal(204)
    }
    finally {
      clock.restore()
    }
  })

  it('should answer 500 when the database fails', async function() {
    dbapi.loadAccessToken.withArgs(TOKEN).rejects(new Error('down'))
    expect((await call({authorization: basic('user', TOKEN)})).code).to.equal(500)
  })
})
