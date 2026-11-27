// Fork (Zebrunner): the access tokens of the API (lib/units/api/controllers/user.ts): the database keeps
// the hash of a token (lib/util/zebrunner-access-tokens.ts), the answer of its creation gives the token
// once, the lists (GET /user/fullAccessTokens, GET /users/{email}/accessTokens of an admin) give the
// titles and the expiries only
import {expect} from 'chai'
import Bluebird from 'bluebird'

import accessTokens from '../../../lib/util/zebrunner-access-tokens.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var SECRET_CI = 'a'.repeat(64)
var EXPIRY = new Date('2030-01-01T00:00:00Z')
var TOKENS = [
  {title: 'ci', id: accessTokens.hashId(SECRET_CI), email: 'user@example.com', expiresAt: null}
, {
    title: 'laptop', id: accessTokens.hashId('b'.repeat(64)), email: 'user@example.com'
  , expiresAt: EXPIRY
  }
]
var saved: Array<{email: string, token: Record<string, unknown>}> = []
var removed: string[] = []

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  loadAccessTokens: function() {
    return Bluebird.resolve({
      toArray: function(callback: (err: Error | null, tokens: unknown[]) => void) {
        callback(null, TOKENS.map(function(token) {
          return Object.assign({}, token)
        }))
      }
    })
  }
, loadAccessToken: function(secret: string) {
    var token = TOKENS.find(function(token) {
      return token.id === accessTokens.hashId(secret)
    })
    return Bluebird.resolve(token ? Object.assign({}, token) : null)
  }
, saveUserAccessToken: function(email: string, token: Record<string, unknown>) {
    saved.push({email: email, token: token})
    return Bluebird.resolve({inserted: 1})
  }
, removeAccessToken: function(id: string) {
    removed.push(id)
    return Bluebird.resolve({deleted: 1})
  }
}})
var user = await importFresh(new URL('../../../lib/units/api/controllers/user.js', import.meta.url))
restoreDbApi()
restoreDb()

function call(handler: (req: unknown, res: unknown) => void, params: Record<string, unknown> = {}) {
  return new Promise<{code: number, body: Record<string, unknown>}>(function(resolve) {
    var swaggerParams: Record<string, {value: unknown}> = {}
    Object.keys(params).forEach(function(name) {
      swaggerParams[name] = {value: params[name]}
    })
    var res = {
      status: function(code: number) {
        return {
          json: function(body: Record<string, unknown>) {
            resolve({code: code, body: body})
          }
        }
      }
    }
    handler({
      user: {email: 'user@example.com', group: 'group'}
    , swagger: {params: swaggerParams}
    , options: {pushdev: {send: function() {}}}
    }, res)
  })
}

describe('zebrunner: the access tokens of the API', function() {
  beforeEach(function() {
    saved = []
    removed = []
  })

  it('should list the titles and expiries, never the ids, emails or jwts', async function() {
    var answer = await call(user.getAccessTokens)
    expect(answer.code).to.equal(200)
    expect(answer.body.tokens).to.deep.equal([
      {title: 'ci', expiresAt: null}
    , {title: 'laptop', expiresAt: EXPIRY}
    ])
  })

  it('should give a token by its secret to its user, not by its hash', async function() {
    var answer = await call(user.getAccessToken, {id: SECRET_CI})
    expect(answer.code).to.equal(200)
    expect(answer.body.token).to.deep.equal({title: 'ci', id: SECRET_CI, expiresAt: null})
    expect((await call(user.getAccessToken, {id: TOKENS[0]!.id})).code).to.equal(404)
  })

  it('should give a new token once and save its secret for the hash only', async function() {
    var answer = await call(user.createAccessToken, {title: 'new'})
    expect(answer.code).to.equal(201)
    var token = answer.body.token as {id: string, title: string, expiresAt: unknown}
    expect(token.id).to.match(/^[0-9a-f]{64}$/)
    expect(token).to.include({title: 'new', expiresAt: null})
    expect(saved).to.deep.equal([
      {email: 'user@example.com', token: {title: 'new', secret: token.id, expiresAt: null}}
    ])
  })

  it('should give a new token with a ttl its expiry', async function() {
    var before = Date.now()
    var answer = await call(user.createAccessToken, {title: 'short', ttl: 3600})
    expect(answer.code).to.equal(201)
    var expiry = (answer.body.token as {expiresAt: Date}).expiresAt.getTime()
    expect(expiry).to.be.within(before + 3600 * 1000, Date.now() + 3600 * 1000)
    expect((saved[0]!.token.expiresAt as Date).getTime()).to.equal(expiry)
  })

  it('should refuse a ttl out of its bounds', async function() {
    expect((await call(user.createAccessToken, {title: 'x', ttl: 59})).code).to.equal(400)
    expect((await call(user.createAccessToken, {title: 'x', ttl: 315360001})).code).to.equal(400)
    expect(saved).to.deep.equal([])
  })

  it('should remove the document of the hash of a token', async function() {
    var answer = await call(user.deleteAccessToken, {id: SECRET_CI})
    expect(answer.code).to.equal(200)
    expect(removed).to.deep.equal([TOKENS[0]!.id])
    expect((await call(user.deleteAccessToken, {id: TOKENS[1]!.id})).code).to.equal(404)
  })
})
