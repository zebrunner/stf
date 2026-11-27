// Fork (Zebrunner): the access tokens against a real RethinkDB (lib/db/api.ts): the hashes of new tokens,
// the earlier documents (the id was the token) until `stf migrate` replaces them by their hashes. Runs
// when STF_TEST_RETHINKDB is the address of a RethinkDB (tcp://127.0.0.1:28015, CI); every run uses a
// database of its own and drops it.
import crypto from 'node:crypto'

import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

import {expect} from 'chai'
import r from 'rethinkdb'

import accessTokens from '../../../lib/util/zebrunner-access-tokens.js'
import jwtutil from '../../../lib/util/jwtutil.js'
import type DbApi from '../../../lib/db/api.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var address = process.env.STF_TEST_RETHINKDB
var SECRET = 'access-tokens-secret'
var USER = 'user@example.com'

;(address ? describe : describe.skip)('zebrunner: access tokens with RethinkDB', function() {
  this.timeout(30000)

  var conn: r.Connection
   , dbapi: typeof DbApi
  var database = 'stf_test_tokens_' + crypto.randomBytes(4).toString('hex')
  var restore: Array<() => void> = []

  function all(): Promise<Array<Record<string, unknown>>> {
    return r.table('accessTokens').run(conn).then(function(cursor) {
      return cursor.toArray()
    })
  }

  // legacy <secret> <title>: a token of an earlier STF, its id is the token
  function legacy(secret: string, title: string) {
    return r.table('accessTokens').insert({
      id: secret
    , email: USER
    , title: title
    , jwt: jwtutil.encode({payload: {email: USER, name: 'user'}, secret: SECRET})
    }).run(conn)
  }

  before(async function() {
    var url = new URL(address!)
    conn = await r.connect({host: url.hostname, port: Number(url.port || 28015), db: database})
    restore.push(mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {
      run: function(query: r.Operation<unknown>) {
        return query.run(conn)
      }
    }}))
    dbapi = (await importFresh(new URL('../../../lib/db/api.js', import.meta.url))).default
    var setup = (await import('../../../lib/db/setup.js')).default
    await setup(conn)
  })

  after(async function() {
    restore.forEach(function(undo) {
      undo()
    })
    if (conn) {
      await r.dbDrop(database).run(conn)
      await conn.close()
    }
  })

  beforeEach(async function() {
    await r.table('accessTokens').delete().run(conn)
  })

  it('should keep the hash of a new token and find it by the token only', async function() {
    var secret = accessTokens.newSecret()
    await dbapi.saveUserAccessToken(USER, {secret: secret, title: 'ci'})
    var stored = await all()
    expect(stored).to.have.length(1)
    expect(JSON.stringify(stored)).to.not.include(secret)
    var token = await dbapi.loadAccessToken(secret)
    expect(token).to.include({id: accessTokens.hashId(secret), email: USER, title: 'ci'})
    expect(accessTokens.emailOf(token, SECRET)).to.equal(USER)
    expect(await dbapi.loadAccessToken(accessTokens.hashId(secret))).to.equal(null)
    expect(await dbapi.loadAccessToken(token!.id)).to.equal(null)
    expect(await dbapi.loadAccessToken(token!.id.slice(accessTokens.HASH_PREFIX.length)))
      .to.equal(null)
    await dbapi.removeAccessToken(token!.id)
    expect(await all()).to.have.length(0)
  })

  it('should keep the expiry of a token', async function() {
    var secret = accessTokens.newSecret()
    var expiresAt = new Date(Date.now() - 1000)
    await dbapi.saveUserAccessToken(USER, {secret: secret, title: 'old', expiresAt: expiresAt})
    var token = await dbapi.loadAccessToken(secret)
    expect(new Date(token!.expiresAt!).getTime()).to.equal(expiresAt.getTime())
    expect(accessTokens.emailOf(token, SECRET)).to.equal(null)
  })

  it('should find an earlier token until it is hashed, then by its hash only', async function() {
    var old = 'a'.repeat(64)
    await legacy(old, 'ci')
    await legacy('b'.repeat(64), 'laptop')
    var before = await dbapi.loadAccessToken(old)
    expect(before).to.include({id: old})
    expect(accessTokens.emailOf(before, SECRET)).to.equal(USER)

    expect(await dbapi.hashAccessTokens()).to.equal(2)
    var stored = await all()
    expect(stored.map(function(token) {
      return token.id
    }).sort()).to.eql([accessTokens.hashId(old), accessTokens.hashId('b'.repeat(64))].sort())
    expect(JSON.stringify(stored)).to.not.include(old)
    expect(stored.every(function(token) {
      return !('jwt' in token) && token.email === USER
    })).to.equal(true)
    var after = await dbapi.loadAccessToken(old)
    expect(after).to.include({id: accessTokens.hashId(old), title: 'ci'})
    expect(accessTokens.emailOf(after, SECRET)).to.equal(USER)
    expect(await dbapi.hashAccessTokens()).to.equal(0)
  })

  it('should finish a migration that stopped between the hash and the removal', async function() {
    var old = 'c'.repeat(64)
    await legacy(old, 'ci')
    await r.table('accessTokens').insert(accessTokens.hashedDocument({
      id: old, email: USER, title: 'ci'
    })).run(conn)
    expect(await dbapi.hashAccessTokens()).to.equal(1)
    expect((await all()).map(function(token) {
      return token.id
    })).to.eql([accessTokens.hashId(old)])
  })

  it('should hash the earlier tokens in stf migrate', async function() {
    var old = 'd'.repeat(64)
    await legacy(old, 'mcloud')
    var env: Record<string, string> = {}
    Object.entries(process.env).forEach(function([name, value]) {
      if (!/^(STF_|RETHINKDB_|SECRET$)/.test(name) && typeof value === 'string') {
        env[name] = value
      }
    })
    Object.assign(env, {RETHINKDB_PORT_28015_TCP: address!, RETHINKDB_ENV_DATABASE: database})
    var code = await new Promise<number | null>(function(resolve) {
      spawn(process.execPath, [
        fileURLToPath(new URL('../../../lib/cli/index.js', import.meta.url))
      , 'migrate'
      ], {env: env, stdio: 'ignore'}).on('exit', resolve)
    })
    expect(code).to.equal(0)
    var token = await dbapi.loadAccessToken(old)
    expect(token).to.include({id: accessTokens.hashId(old), title: 'mcloud'})
    expect(accessTokens.emailOf(token, SECRET)).to.equal(USER)
  })
})
