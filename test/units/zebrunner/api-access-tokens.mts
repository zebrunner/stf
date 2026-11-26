// Fork (Zebrunner): the id of an access token is its secret: the lists of the tokens
// (GET /user/fullAccessTokens, GET /users/{email}/accessTokens of an admin) give the titles only,
// lib/units/api/controllers/user.ts
import {expect} from 'chai'
import Bluebird from 'bluebird'

import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var TOKENS = [
  {title: 'ci', id: 'a'.repeat(64), jwt: 'jwt-1', email: 'user@example.com'}
, {title: 'laptop', id: 'b'.repeat(64), jwt: 'jwt-2', email: 'user@example.com'}
]

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
, loadAccessToken: function(id: string) {
    return Bluebird.resolve(Object.assign({}, TOKENS.find(function(token) {
      return token.id === id
    })))
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
    handler({user: {email: 'user@example.com'}, swagger: {params: swaggerParams}}, res)
  })
}

describe('zebrunner: the access tokens of the API', function() {
  it('should list the titles of the tokens, never their ids, emails or jwts', async function() {
    var answer = await call(user.getAccessTokens)
    expect(answer.code).to.equal(200)
    expect(answer.body.tokens).to.deep.equal([{title: 'ci'}, {title: 'laptop'}])
  })

  it('should give a token by its id to the one who has the id', async function() {
    var answer = await call(user.getAccessToken, {id: 'a'.repeat(64)})
    expect(answer.code).to.equal(200)
    expect(answer.body.token).to.deep.equal({title: 'ci', id: 'a'.repeat(64)})
  })
})
