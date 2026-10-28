// Fork (Zebrunner): the admin operations of the REST API need an admin, with the session cookie of the app as with
// an access token, lib/units/api/helpers/securityHandlers.ts
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

import {expect} from 'chai'
import Bluebird from 'bluebird'

import jwtutil from '../../../lib/util/jwtutil.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

interface Operation {
  tags?: string[]
}

interface Outcome {
  code: number | null
  user: {email: string} | null
}

var SECRET = 'api-secret'
var USERS: Record<string, {email: string, privilege: string}> = {
  'user@example.com': {email: 'user@example.com', privilege: 'user'}
, 'admin@example.com': {email: 'admin@example.com', privilege: 'admin'}
}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  loadUser: function(email: string) {
    return Bluebird.resolve(USERS[email] || null)
  }
  // the id of a token is the email of its user here
, loadAccessToken: function(id: string) {
    return Bluebird.resolve({jwt: jwtutil.encode({payload: {email: id, name: id}, secret: SECRET})})
  }
}})
var securityHandlers = await importFresh(
  new URL('../../../lib/units/api/helpers/securityHandlers.js', import.meta.url)
)
restoreDbApi()
restoreDb()

// js-yaml comes with the swagger middleware of the API unit
var yaml = createRequire(import.meta.url)('js-yaml') as {load(text: string): unknown}
var swagger = yaml.load(await readFile(
  new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
, 'utf8'
)) as {paths: Record<string, Record<string, Operation>>}

var operations: Array<{name: string, operation: Operation}> = []
Object.entries(swagger.paths).forEach(function([path, methods]) {
  Object.entries(methods).forEach(function([method, operation]) {
    if (operation && typeof operation === 'object' && Array.isArray(operation.tags)) {
      operations.push({name: `${method.toUpperCase()} ${path}`, operation: operation})
    }
  })
})
var adminOperations = operations.filter(function(entry) {
  return entry.operation.tags!.includes('admin')
})

// authenticate <operation> <credentials>: the status the handler answers with, or the user it lets through
function authenticate(
  operation: Operation
, credentials: {cookie?: string, token?: string}
): Promise<Outcome> {
  return new Promise<Outcome>(function(resolve) {
    var req = {
      headers: credentials.token ? {authorization: `Bearer ${credentials.token}`} : {}
    , session: credentials.cookie ? {jwt: {email: credentials.cookie}} : null
    , swagger: {operation: {definition: operation}}
    , options: {secret: SECRET}
    } as Record<string, unknown>
    var res = {
      status: function(code: number) {
        return {
          json: function() {
            resolve({code: code, user: null})
          }
        }
      }
    }
    securityHandlers.accessTokenAuth(req, res, function() {
      resolve({code: null, user: req.user as {email: string}})
    })
  })
}

describe('zebrunner: admin operations of the API', function() {
  it('should find the admin operations of the API', function() {
    expect(adminOperations.length).to.be.at.least(20)
    expect(adminOperations.map(function(entry) {
      return entry.name
    })).to.include.members([
      'GET /users/{email}/accessTokens'
    , 'DELETE /users/{email}'
    , 'PUT /devices/{serial}'
    ])
  })

  ;[['a session cookie', 'cookie'], ['an access token', 'token']].forEach(function([label, kind]) {
    it(`should refuse every admin operation to a user with ${label}`, async function() {
      var credentials = {[kind!]: 'user@example.com'}
      for (var entry of adminOperations) {
        var outcome = await authenticate(entry.operation, credentials)
        expect(outcome, entry.name).to.eql({code: 403, user: null})
      }
    })

    it(`should let an admin with ${label} through`, async function() {
      var credentials = {[kind!]: 'admin@example.com'}
      for (var entry of adminOperations) {
        var outcome = await authenticate(entry.operation, credentials)
        expect(outcome.user && outcome.user.email, entry.name).to.equal('admin@example.com')
      }
    })

    it(`should let a user with ${label} use the other operations`, async function() {
      var credentials = {[kind!]: 'user@example.com'}
      var others = operations.filter(function(entry) {
        return !entry.operation.tags!.includes('admin')
      })
      expect(others.length).to.be.above(0)
      for (var entry of others) {
        var outcome = await authenticate(entry.operation, credentials)
        expect(outcome.user && outcome.user.email, entry.name).to.equal('user@example.com')
      }
    })
  })
})
