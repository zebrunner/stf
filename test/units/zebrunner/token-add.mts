// Fork (Zebrunner): `stf token-add` (lib/cli/token-add) against a real RethinkDB: the access token
// of the admin that `./zebrunner.sh start` of mcloud makes for STF_TOKEN. Runs when STF_TEST_RETHINKDB
// is the address of a RethinkDB (tcp://127.0.0.1:28015, CI); every run uses a database of its own and
// drops it.
import crypto from 'node:crypto'

import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

import {expect} from 'chai'
import r from 'rethinkdb'

import accessTokens from '../../../lib/util/zebrunner-access-tokens.js'

var address = process.env.STF_TEST_RETHINKDB
var SECRET = 'token-add-secret'
var ADMIN = 'admin@example.com'

;(address ? describe : describe.skip)('zebrunner: stf token-add with RethinkDB', function() {
  this.timeout(30000)

  var conn: r.Connection
  var database = 'stf_test_token_' + crypto.randomBytes(4).toString('hex')

  before(async function() {
    var url = new URL(address!)
    conn = await r.connect({host: url.hostname, port: Number(url.port || 28015), db: database})
    var setup = (await import('../../../lib/db/setup.js')).default
    await setup(conn)
    await r.table('users').insert({email: ADMIN, name: 'admin', privilege: 'admin'}).run(conn)
  })

  after(async function() {
    if (conn) {
      await r.dbDrop(database).run(conn)
      await conn.close()
    }
  })

  // tokenAdd <args> <env>: runs the command in a process of its own, as mcloud does, with the database
  // of the test and the variables of env (no STF_ or RETHINKDB_ variable of the environment of the test)
  function tokenAdd(args: string[], extra: Record<string, string> = {}) {
    var env: Record<string, string> = {}
    Object.entries(process.env).forEach(function([name, value]) {
      if (!/^(STF_|RETHINKDB_|SECRET$)/.test(name) && typeof value === 'string') {
        env[name] = value
      }
    })
    Object.assign(env, {RETHINKDB_PORT_28015_TCP: address!, RETHINKDB_ENV_DATABASE: database})
    Object.assign(env, extra)
    return new Promise<{code: number | null, stdout: string}>(function(resolve) {
      var child = spawn(process.execPath, [
        fileURLToPath(new URL('../../../lib/cli/index.js', import.meta.url))
      , 'token-add'
      ].concat(args), {env: env, stdio: ['ignore', 'pipe', 'ignore']})
      var stdout = ''
      child.stdout!.on('data', function(chunk) {
        stdout += chunk
      })
      child.on('exit', function(code) {
        resolve({code: code, stdout: stdout})
      })
    })
  }

  function tokens(): Promise<Array<{
    id: string, title: string, email: string, jwt?: string, expiresAt?: Date | null
  }>> {
    return r.table('accessTokens').filter({email: ADMIN}).run(conn)
      .then(function(cursor) {
        return cursor.toArray()
      })
  }

  it('should create an access token of the admin and keep its hash only', async function() {
    var result = await tokenAdd([], {STF_ADMIN_EMAIL: ADMIN, SECRET: SECRET})
    expect(result.code).to.equal(0)
    var id = /^token=([0-9a-f]{64})$/m.exec(result.stdout)![1]!
    var saved = await tokens()
    expect(saved).to.have.length(1)
    expect(saved[0]).to.include({id: accessTokens.hashId(id), title: 'mcloud', email: ADMIN})
    expect(saved[0]!.expiresAt).to.equal(null)
    expect(saved[0]).to.not.have.property('jwt')
    expect(JSON.stringify(saved)).to.not.include(id)
    // the API unit finds the user of the token (lib/units/api/helpers/securityHandlers.ts)
    expect(accessTokens.emailOf(saved[0]!, SECRET)).to.equal(ADMIN)
  })

  it('should give the token the expiry of --ttl', async function() {
    var before = Date.now()
    var result = await tokenAdd(['--email', ADMIN, '--title', 'short', '--ttl', '3600'])
    expect(result.code).to.equal(0)
    var saved = (await tokens()).find(function(token) {
      return token.title === 'short'
    })!
    var expiry = new Date(saved.expiresAt!).getTime()
    expect(expiry).to.be.within(before + 3600 * 1000 - 1000, Date.now() + 3600 * 1000 + 1000)
    expect((await tokenAdd(['--email', ADMIN, '--title', 'bad', '--ttl', '5'])).code).to.equal(1)
  })

  it('should replace the earlier token of the title and keep the other tokens', async function() {
    await r.table('accessTokens')
      .insert({email: ADMIN, id: 'other', title: 'mine', jwt: 'x'}).run(conn)
    var first = await tokenAdd(['--email', ADMIN, '--secret', SECRET])
    var second = await tokenAdd(['--email', ADMIN, '--secret', SECRET])
    expect([first.code, second.code]).to.eql([0, 0])
    var id = /^token=([0-9a-f]{64})$/m.exec(second.stdout)![1]!
    var saved = await tokens()
    expect(saved.map(function(token) {
      return token.title
    }).sort()).to.eql(['mcloud', 'mine', 'short'])
    expect(saved.find(function(token) {
      return token.title === 'mcloud'
    })!.id).to.equal(accessTokens.hashId(id))
  })

  it('should create a token of another title', async function() {
    var result = await tokenAdd(['--email', ADMIN, '--secret', SECRET, '--title', 'grid'])
    expect(result.code).to.equal(0)
    expect((await tokens()).map(function(token) {
      return token.title
    })).to.include('grid')
  })

  it('should fail for an unknown user', async function() {
    expect(await tokenAdd(['--email', 'nobody@example.com', '--secret', SECRET]))
      .to.eql({code: 1, stdout: ''})
  })

  it('should not need the secret of the units', async function() {
    expect((await tokenAdd(['--email', ADMIN, '--title', 'nosecret'])).code).to.equal(0)
  })
})
