// Fork (Zebrunner): the redirect of the app after a sign-in, lib/units/app/middleware/auth.ts
import {expect} from 'chai'
import sinon from 'sinon'

import jwtutil from '../../../lib/util/jwtutil.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var SECRET = 'app-auth-secret'

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  saveUserAfterLogin: sinon.stub().resolves()
, saveSession: sinon.stub().resolves()
}})
var auth = (await importFresh(
  new URL('../../../lib/units/app/middleware/auth.js', import.meta.url)
)).default
restoreDbApi()
restoreDb()

var requests: Array<{session: any, sessionOptions: any}> = []

// signIn <url>: where the app sends the browser that comes from the auth unit with a token
function signIn(url: string): Promise<string> {
  var token = jwtutil.encode({payload: {email: 'user@example.com', name: 'User'}, secret: SECRET})
  var withToken = url + (url.includes('?') ? '&' : '?') + 'jwt=' + token
  return new Promise(function(resolve, reject) {
    var req = {
      query: {jwt: token}
    , url: withToken
    , ip: '127.0.0.1'
    , headers: {}
    , session: {}
    , sessionOptions: {}
    }
    requests.push(req)
    var res = {redirect: resolve}
    auth({secret: SECRET, authUrl: 'http://auth/'})(req, res, reject)
  })
}

describe('zebrunner: app sign-in redirect', function() {
  it('should stay on the page the browser asked for', async function() {
    expect(await signIn('/')).to.equal('?')
  })

  it('should keep the other parameters of the page', async function() {
    expect(await signIn('/?standalone=1')).to.equal('?standalone=1')
  })

  it('should start a session that scripts cannot read', async function() {
    await signIn('/')
    var req = requests[requests.length - 1]!
    expect(req.session.jwt.email).to.equal('user@example.com')
    expect(req.session.jwt.sid).to.be.a('string')
    expect(req.session.jwt.expiresAt).to.be.above(Date.now())
    expect(req.sessionOptions.httpOnly).to.equal(true)
    expect(req.sessionOptions.sameSite).to.equal('lax')
  })
})
