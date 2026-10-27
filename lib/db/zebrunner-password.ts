/**
* Fork (Zebrunner): the password of the admin of RethinkDB.
*
* The units connect as `admin` with the password RETHINKDB_ENV_AUTHKEY (lib/db/index.ts). A database
* created without a password accepts anyone, so `stf migrate`, which runs before the other units,
* sets that password when the database still has none: a deployment turns the authentication on
* by setting the variable. A database with another password is left as it is, the units cannot
* connect to it then.
**/

import r from 'rethinkdb'

import logger from '../util/logger.js'
import srv from '../util/srv.js'

const log = logger.createLogger('db:password')

export interface Endpoint {
  host: string
  port: number
}

export async function endpoint(url: string): Promise<Endpoint> {
  const records = await srv.resolve(url)
  const record = records[0]
  if (!record || !record.name || !record.port) {
    throw new Error(`No RethinkDB host in "${url}"`)
  }
  return {host: String(record.name), port: Number(record.port)}
}

function isAuthError(err: unknown) {
  return err instanceof Error && (err.name === 'ReqlAuthError' || /password/i.test(err.message))
}

// ensureAdminPassword: sets RETHINKDB_ENV_AUTHKEY as the password of the admin of a database that
// has none; true when it set it
export async function ensureAdminPassword(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const password = env.RETHINKDB_ENV_AUTHKEY
  if (!password) {
    return false
  }
  const {host, port} = await endpoint(env.RETHINKDB_PORT_28015_TCP || 'tcp://127.0.0.1:28015')

  try {
    const connection = await r.connect({host: host, port: port, authKey: password})
    await connection.close()
    return false
  }
  catch (err) {
    if (!isAuthError(err)) {
      // not reachable: the connection of the migration reports it
      return false
    }
  }

  let connection: r.Connection
  try {
    connection = await r.connect({host: host, port: port})
  }
  catch (err) {
    if (isAuthError(err)) {
      throw new Error('RethinkDB has another password than RETHINKDB_ENV_AUTHKEY')
    }
    throw err
  }
  try {
    await r.db('rethinkdb').table('users').get('admin').update({password: password}).run(connection)
    log.important('Set RETHINKDB_ENV_AUTHKEY as the password of the admin of RethinkDB')
    return true
  }
  finally {
    await connection.close()
  }
}

export default {ensureAdminPassword}
