// Fork (Zebrunner): GET /users lists every user to an admin only, another user gets itself and the
// users of its groups; only an admin adds every user to a group (PUT /groups/{id}/users without emails),
// lib/units/api/controllers/users.ts and groups.ts
import {expect} from 'chai'
import sinon from 'sinon'

import {importFresh, mockModule} from '../../helpers/module-mock.mts'

interface Reply {
  code: number
  body: any
}

function user(email: string, privilege = 'user') {
  return {email: email, name: email.split('@')[0], privilege: privilege, settings: {}}
}

var USERS = ['admin', 'alice', 'bob', 'carol', 'dave', 'eve'].map(function(name) {
  return user(name + '@example.com', name === 'admin' ? 'admin' : 'user')
})

function group(id: string, owner: string, users: string[], privilege = 'user') {
  return {id: id, owner: {email: owner, name: owner}, users: users, privilege: privilege}
}

var GROUPS = [
  group('root', 'admin@example.com', USERS.map((u) => u.email), 'root')
  // alice owns g1 with bob; carol and alice are in g2 of dave
, group('g1', 'alice@example.com', ['alice@example.com', 'bob@example.com'])
, group('g2', 'dave@example.com', ['dave@example.com', 'carol@example.com', 'alice@example.com'])
]

var dbapi = {
  getUsers: sinon.stub().callsFake(() => Promise.resolve(USERS))
, getRootGroup: sinon.stub().callsFake(() => Promise.resolve(GROUPS[0]))
, getUserGroups: sinon.stub().callsFake(function(email: string) {
    return Promise.resolve(GROUPS.filter((g) => g.users.includes(email)))
  })
, getGroupsByIndex: sinon.stub().callsFake(function(value: string, index: string) {
    return Promise.resolve(index === 'owner' ? GROUPS.filter((g) => g.owner.email === value) : [])
  })
, lockGroupByOwner: sinon.stub()
}

var restoreDb = mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {}})
var restoreDbApi = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: dbapi})
var controllers = new URL('../../../lib/units/api/controllers/', import.meta.url)
var users = await importFresh(new URL('users.js', controllers))
var groups = await importFresh(new URL('groups.js', controllers))
restoreDbApi()
restoreDb()

// call <controller> <route> <params> <user> [body]: the status code and the JSON body of the answer
function call(
  controller: Record<string, (req: object, res: object) => void>
, route: string
, params: Record<string, unknown>
, caller: object
, body?: object
): Promise<Reply> {
  return new Promise<Reply>(function(resolve) {
    var swagger: Record<string, {value: unknown}> = {}
    Object.keys(params).forEach(function(name) {
      swagger[name] = {value: params[name]}
    })
    var reply = {code: 200, body: null as unknown}
    var res = {
      status: function(code: number) {
        reply.code = code
        return res
      }
    , json: function(answer: unknown) {
        reply.body = answer
        resolve(reply)
        return res
      }
    }
    controller[route]!({swagger: {params: swagger}, user: caller, body: body}, res)
  })
}

function emails(reply: Reply): string[] {
  return reply.body.users.map((u: {email: string}) => u.email).sort()
}

describe('zebrunner: users of the API', function() {
  it('should list every user to an admin', async function() {
    var reply = await call(users, 'getUsers', {fields: null}, USERS[0]!)
    expect(reply.code).to.equal(200)
    expect(emails(reply)).to.eql(USERS.map((u) => u.email).sort())
  })

  it('should list a user itself and the users of its groups, not the root group', async function() {
    var alice = await call(users, 'getUsers', {fields: null}, USERS[1]!)
    expect(alice.code).to.equal(200)
    expect(emails(alice)).to.eql([
      'alice@example.com', 'bob@example.com', 'carol@example.com', 'dave@example.com'
    ])
    expect(alice.body.users[0]).to.have.all.keys('email', 'name', 'privilege')
    var bob = await call(users, 'getUsers', {fields: 'email'}, USERS[2]!)
    expect(emails(bob)).to.eql(['alice@example.com', 'bob@example.com'])
    var eve = await call(users, 'getUsers', {fields: null}, USERS[5]!)
    expect(emails(eve)).to.eql(['eve@example.com'])
  })

  it('should add every user to the group of an admin only', async function() {
    var reply = await call(groups, 'addGroupUsers', {id: 'g1'}, USERS[1]!, {})
    expect(reply.code).to.equal(400)
    expect(dbapi.lockGroupByOwner.called).to.equal(false)
  })
})
