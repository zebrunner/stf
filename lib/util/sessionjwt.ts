/**
* Fork (Zebrunner): the user of a session cookie (lib/util/authsession.ts) and the check of its
* expiry, apart from the sessions in the database: the storage authentication of the device units
* (lib/util/storageauth.ts) uses them, and the device units have no database.
**/

export interface SessionJwt {
  email: string
  name: string
  // the session in the database and when it expires (ms since the epoch)
  sid?: string
  expiresAt?: number
}

// isFresh <jwt>: whether the cookie of a session has not expired, for the units without a database
export function isFresh(jwt: SessionJwt | undefined): boolean {
  return Boolean(jwt && jwt.sid && jwt.expiresAt && jwt.expiresAt > Date.now())
}
