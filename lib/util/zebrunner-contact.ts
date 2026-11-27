/**
* Fork (Zebrunner): GET /auth/contact of the sign-in units, the address of the "Contact Support" link of
* the UI (the sign-in form and the header of the app, res/app/src/core/contact.ts).
*
* Upstream it answered the name and the email of the owner of the root group (the admin) to anyone:
* before a sign-in, and with the mock sign-in to whoever has the shared password of the users. Here:
* - STF_CONTACT_EMAIL set: that address for everyone (e.g. a support mailbox, never a person's name);
* - otherwise the email of the admin (not its name) for a signed-in user only: the session cookie of
*   the app with an active session (lib/util/authsession.ts);
* - otherwise no address ({contact: {}}): the UI keeps its default one.
**/

import type express from 'express'

import dbapi from '../db/api.js'
import authsession from './authsession.js'
import type {SessionJwt} from './sessionjwt.js'
import type logger from './logger.js'

export function contactEmail(): string {
  return (process.env.STF_CONTACT_EMAIL || '').trim()
}

// contact <log>: the handler of GET /auth/contact, after the session cookie of the unit
// (lib/util/zebrunner-session.ts)
export function contact(log: logger.Instance): express.RequestHandler {
  return function(req, res) {
    var configured = contactEmail()
    if (configured) {
      res.status(200).json({success: true, contact: {email: configured}})
      return
    }
    var session = (req as {session?: {jwt?: SessionJwt} | null}).session
    authsession.isActive(session?.jwt)
      .then(function(active) {
        return active ? dbapi.getRootGroup().then(function(group) {
          return {email: group.owner.email}
        }) : {}
      })
      .then(function(contact) {
        res.status(200).json({success: true, contact: contact})
      })
      .catch(function(err) {
        log.error('Unable to tell the contact', err)
        res.status(500).json({success: false, error: 'ServerError'})
      })
  }
}

export default {contact, contactEmail}
