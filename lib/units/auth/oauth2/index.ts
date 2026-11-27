/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import http from 'http'

import express from 'express'
import passport from 'passport'

import logger from '../../../util/logger.js'
import urlutil from '../../../util/urlutil.js'
import jwtutil from '../../../util/jwtutil.js'
import pathutil from '../../../util/pathutil.js'
// Fork (Zebrunner): the domain, the verified email and the short token of the sign-in
import signin, {type OAuth2Profile} from '../../../util/zebrunner-signin.js'
import Strategy from './strategy.js'

import zebrunnerSession from '../../../util/zebrunner-session.js'
import zebrunnerContact from '../../../util/zebrunner-contact.js'
import type {VerifyCallback} from 'passport-oauth2'

interface OAuth2AuthOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
  domain?: string
  // Fork (Zebrunner): a profile without email_verified is taken (a provider that never sends it)
  allowMissingEmailVerified?: boolean
  oauth: ConstructorParameters<typeof Strategy>[0]
}

// Fork (Zebrunner): the state of a sign-in lives in a cookie of its own for this long
export var STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000

export default function(options: OAuth2AuthOptions) {
  var log = logger.createLogger('auth-oauth2')
  var app = express()
  var server = http.createServer(app)

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  // Fork (Zebrunner): the page of a rejected email, it was rendered without a view engine (500)
  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('app/views'))

  // Fork (Zebrunner): the admin for the signed-in users only (the session cookie of the app), only read
  // here, lib/util/zebrunner-contact.ts
  app.get(
    '/auth/contact'
  , zebrunnerSession.sessionCookie(options.ssid, options.secret, options.appUrl)
  , zebrunnerContact.contact(log)
  )

  function verify(
    accessToken: string
  , refreshToken: string
  , profile: Express.User
  , done: VerifyCallback
  ) {
    done(null, profile)
  }

  // Fork (Zebrunner): an authenticator of this unit, not the one of the module (another unit of the
  // process would replace its strategy)
  var authenticator = new passport.Passport()
  authenticator.use(new Strategy(options.oauth, verify))

  // Fork (Zebrunner): the identity of a user is the email of the provider: warn about the settings
  // that let other people of the provider in (ZEBRUNNER.md#oauth2-sign-in)
  if (!String(options.domain || '').trim()) {
    log.warn('No --oauth-domain (OAUTH_DOMAIN): every account of the provider with a verified ' +
      'email can sign in')
  }
  if (options.allowMissingEmailVerified) {
    log.warn('--oauth-allow-missing-email-verified: a profile without email_verified is taken, ' +
      'the provider must let no user choose an email it does not own')
  }
  if (!options.oauth.state) {
    log.warn('--no-oauth-state: the sign-in has no state parameter (login CSRF)')
  }

  // Fork (Zebrunner): passport-oauth2 keeps the state parameter in req.session: a signed cookie of
  // the sign-in only (not the session cookie of the app), HttpOnly, SameSite=Lax (the provider
  // redirects back with a top-level GET), Secure for an https app, gone after the callback
  if (options.oauth.state) {
    app.use(zebrunnerSession.sessionCookie(
      options.ssid + '-oauth2'
    , options.secret
    , options.appUrl
    , {maxAge: STATE_COOKIE_MAX_AGE_MS}
    ))
  }

  app.use(authenticator.initialize())
  // Fork (Zebrunner): a refused callback is logged (no code, token or state); a state that does not
  // match the cookie gets a page with a link instead of a new sign-in, so a browser that keeps no
  // cookie does not go back and forth between the provider and STF
  app.use(function(req, res, next) {
    authenticator.authenticate('oauth2', {session: false}, function(
      err: unknown
    , user: Express.User | false
    , info?: {message?: string}
    ) {
      if (err) {
        return next(err)
      }
      if (!user) {
        var reason = info && info.message || 'no user'
        log.warn('OAuth2 sign-in refused: %s', reason)
        if (/state/i.test(reason)) {
          return res.status(400).render('rejected-email')
        }
        return res.redirect('/auth/oauth/')
      }
      req.user = user
      return next()
    })(req, res, next)
  })

  app.disable('x-powered-by')

  // Fork (Zebrunner): `user@<domain>` only and an email the provider reports as verified
  function isEmailAllowed(profile: Express.User): boolean {
    return signin.isEmailAllowed(profile.email, options.domain) &&
      signin.isEmailVerified(profile, options.allowMissingEmailVerified)
  }

  app.get(
    '/auth/oauth/callback'
  , function(req, res) {
      // Fork (Zebrunner): the state is used, its cookie goes
      if (req.session) {
        req.session = null
      }
      if (isEmailAllowed(req.user!)) {
        res.redirect(urlutil.addParams(options.appUrl, {
          jwt: jwtutil.encode({
            payload: {
              email: req.user!.email!
            , name: req.user!.email!.split('@', 1).join('')
            }
          , secret: options.secret
          , header: {
              // Fork (Zebrunner)
              exp: signin.signInTokenExpiry()
            }
          })
        }))
      }
      else {
        // Fork (Zebrunner): the email and its verification only, not the whole profile
        var profile = (req.user || {}) as OAuth2Profile
        log.warn('Missing, unverified or disallowed email in the profile: %s (email_verified %s)'
        , profile.email
        , profile.email_verified ?? profile.verified_email)
        res.render('rejected-email')
      }
    }
  )

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
