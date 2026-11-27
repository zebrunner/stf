// Fork (Zebrunner): the API unit takes an access token by the hash of the token, refuses it after its
// expiry and takes an earlier document (not hashed yet by stf migrate) as before,
// lib/units/api/helpers/securityHandlers.ts
import {expect} from 'chai'
import Bluebird from 'bluebird'

import accessTokens from '../../../lib/util/zebrunner-access-tokens.js'
import jwtutil from '../../../lib/util/jwtutil.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var SECRET = 'api-secret'
var EMAIL = 'user@example.com'
var HASHED = '1'.repeat(64)
var EXPIRED = '2'.repeat(64)
var LEGACY = '3'.repeat(64)
var DOCUMENTS: Record<string, Record<string, unknown>> = {
  [accessTokens.hashId(HASHED)]: accessTokens.newDocument(HASHED, EMAIL, 'ci') as never
, [accessTokens.hashId(EXPIRED)]:
    accessTokens.newDocument(EXPIRED, EMAIL, 'old', new Date(Date.now() - 1000)) as never
, [LEGACY]: {
    id: LEGACY, email: EMAIL, title: 'legacy'
  , jwt: jwtutil.encode({payload: {email: EMAIL, name: 'user'}, secret: SECRET})
  }
}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  loadUser: function(email: string) {
    return Bluebird.resolve(email === EMAIL ? {email: EMAIL, privilege: 'user'} : null)
  }
  // as lib/db/api.ts: the hash first, then an earlier document by the token
, loadAccessToken: function(secret: string) {
    return Bluebird.resolve(
      DOCUMENTS[accessTokens.hashId(secret)] ||
      (accessTokens.isLegacySecret(secret) && DOCUMENTS[secret]) || null
    )
  }
}})
var securityHandlers = await importFresh(
  new URL('../../../lib/units/api/helpers/securityHandlers.js', import.meta.url)
)
restoreDbApi()
restoreDb()

function authenticate(token: string): Promise<number | string> {
  return new Promise(function(resolve) {
    var req = {
      headers: {authorization: 'Bearer ' + token}
    , swagger: {operation: {definition: {tags: ['user']}}}
    , options: {secret: SECRET}
    } as Record<string, unknown>
    var res = {
      status: function(code: number) {
        return {
          json: function() {
            resolve(code)
          }
        }
      }
    }
    securityHandlers.accessTokenAuth(req, res, function() {
      resolve((req.user as {email: string}).email)
    })
  })
}

describe('zebrunner: access tokens in the API unit', function() {
  it('should take a token by its hash', async function() {
    expect(await authenticate(HASHED)).to.equal(EMAIL)
  })

  it('should refuse an expired token, an unknown one and the hash of a token', async function() {
    expect(await authenticate(EXPIRED)).to.equal(401)
    expect(await authenticate('4'.repeat(64))).to.equal(401)
    expect(await authenticate(accessTokens.hashId(HASHED))).to.equal(401)
  })

  it('should take an earlier token until stf migrate hashed it', async function() {
    expect(await authenticate(LEGACY)).to.equal(EMAIL)
  })
})
