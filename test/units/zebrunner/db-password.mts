// Fork (Zebrunner): the password of the admin of RethinkDB, lib/db/zebrunner-password.ts
import {expect} from 'chai'
import sinon from 'sinon'
import r from 'rethinkdb'

import {ensureAdminPassword} from '../../../lib/db/zebrunner-password.js'

function authError() {
  var err = new Error('Wrong password')
  err.name = 'ReqlAuthError'
  return err
}

describe('zebrunner: RethinkDB password', function() {
  var env = {RETHINKDB_PORT_28015_TCP: 'tcp://127.0.0.1:28015', RETHINKDB_ENV_AUTHKEY: 's3cret'}
  var connect: sinon.SinonStub, update: sinon.SinonStub, close: sinon.SinonStub

  beforeEach(function() {
    close = sinon.stub().resolves()
    connect = sinon.stub(r, 'connect')
    update = sinon.stub().returns({run: sinon.stub().resolves({replaced: 1})})
    sinon.stub(r, 'db').returns({
      table: sinon.stub().returns({get: sinon.stub().returns({update: update})})
    } as unknown as ReturnType<typeof r.db>)
  })

  afterEach(function() {
    sinon.restore()
  })

  it('should do nothing without RETHINKDB_ENV_AUTHKEY', async function() {
    expect(await ensureAdminPassword({})).to.equal(false)
    expect(connect.called).to.equal(false)
  })

  it('should leave a database that has the password', async function() {
    connect.resolves({close: close})
    expect(await ensureAdminPassword(env)).to.equal(false)
    expect(connect.firstCall.args[0]).to.eql({host: '127.0.0.1', port: 28015, authKey: 's3cret'})
    expect(update.called).to.equal(false)
  })

  it('should set the password of a database that has none', async function() {
    connect.onFirstCall().rejects(authError())
    connect.onSecondCall().resolves({close: close})
    expect(await ensureAdminPassword(env)).to.equal(true)
    expect(connect.secondCall.args[0]).to.eql({host: '127.0.0.1', port: 28015})
    expect(update.firstCall.args[0]).to.eql({password: 's3cret'})
    expect(close.calledOnce).to.equal(true)
  })

  it('should refuse a database with another password', async function() {
    connect.rejects(authError())
    var err = await ensureAdminPassword(env).then(function() {
      return null
    }, function(error: Error) {
      return error
    })
    expect(err && err.message).to.match(/another password/)
    expect(update.called).to.equal(false)
  })

  it('should leave an unreachable database to the connection of the migration', async function() {
    connect.rejects(new Error('Could not connect to 127.0.0.1:28015'))
    expect(await ensureAdminPassword(env)).to.equal(false)
    expect(connect.calledOnce).to.equal(true)
  })
})
