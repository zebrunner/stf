// Fork (Zebrunner): the description of the API (GET /api/v1/swagger.json) is for a signed-in user or an
// access token, lib/units/api/index.ts
import {expect} from 'chai'
import Bluebird from 'bluebird'
import sinon from 'sinon'

import jwtutil from '../../../lib/util/jwtutil.js'
import zmqutil from '../../../lib/util/zmqutil.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'
import {sessionCookie, startUnit, type Running} from '../../helpers/zebrunner.mts'

var SECRET = 'swagger-secret'

describe('zebrunner: description of the API', function() {
  var api: Running, restores: Array<() => void>

  // swagger answers once its description is loaded
  async function get(path: string, headers: Record<string, string> = {}) {
    for (var tries = 0; ; tries++) {
      var res = await fetch(api.origin + path, {headers: headers})
      if (res.status !== 404 || tries > 50) {
        return res
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  before(async function() {
    restores = [
      mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
    , mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
        loadUser: function(email: string) {
          return Bluebird.resolve({email: email, privilege: 'user'})
        }
      , loadAccessToken: function(id: string) {
          var payload = {email: 'user@example.com', name: 'user'}
          var jwt = jwtutil.encode({payload: payload, secret: SECRET})
          return Bluebird.resolve(id === 'good' ? {jwt: jwt} : null)
        }
      , loadSession: function(id: string) {
          return Bluebird.resolve(id === 'active' ?
            {id: id, email: 'user@example.com', expiresAt: Date.now() + 60000} :
            null)
        }
      }})
    ]
    // fresh copies: the ones another test file loaded keep the db mock of that file
    var helpers = [
      '../../../lib/util/authsession.js'
    , '../../../lib/units/api/helpers/securityHandlers.js'
    ]
    for (var helper of helpers) {
      var url = new URL(helper, import.meta.url)
      restores.push(mockModule(url, {...await importFresh(url)}))
    }
    // no ZeroMQ: its sockets would keep the tests running
    var socket = sinon.stub(zmqutil, 'socket').callsFake(function() {
      return {connect() {}, subscribe() {}, on() {}, close() {}, send() {}} as unknown as
        ReturnType<typeof zmqutil.socket>
    })
    restores.push(function() {
      socket.restore()
    })
    api = await startUnit(new URL('../../../lib/units/api/index.js', import.meta.url), {
      secret: SECRET
    , ssid: 'ssid'
    , endpoints: {push: [], sub: [], pushdev: [], subdev: []}
    })
    // the swagger middlewares load the controllers (and the database) once the description is read:
    // the mocks stay until then
    await get('/api/v1/swagger.json')
  })

  after(async function() {
    await api.close()
    restores.forEach(function(restore) {
      restore()
    })
  })

  it('should refuse the description without a user', async function() {
    expect((await get('/api/v1/swagger.json')).status).to.equal(401)
    expect((await get('/API/V1/Swagger.json')).status).to.equal(401)
    expect((await get('/api-docs')).status).to.equal(401)
    var wrong = await get('/api/v1/swagger.json', {authorization: 'Bearer wrong'})
    expect(wrong.status).to.equal(401)
  })

  it('should give the description to an access token', async function() {
    var res = await get('/api/v1/swagger.json', {authorization: 'Bearer good'})
    expect(res.status).to.equal(200)
    expect((await res.json() as {swagger: string}).swagger).to.equal('2.0')
  })

  it('should give the description to the session of the app', async function() {
    var cookie = await sessionCookie(SECRET, {jwt: {
      email: 'user@example.com'
    , sid: 'active'
    , expiresAt: Date.now() + 60000
    }})
    var res = await get('/api/v1/swagger.json', {cookie: cookie})
    expect(res.status).to.equal(200)
  })
})
