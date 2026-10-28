/**
* Fork (Zebrunner): the rules of the sign-in units that hand the user to the app with a token in its
* URL (auth-oauth2, auth-mock, as auth-ldap and auth-zebrunner do).
*
* - the token expires in two minutes: the app takes it over at once, a URL may stay in logs;
* - an OAuth2 user needs an email of the allowed domain (`user@example.com` for `example.com`, not
*   `user@evil-example.com`) that the provider did not report as unverified (`email_verified`,
*   OpenID Connect): an unverified email could be the one of somebody else, e.g. of the admin.
**/

export const SIGN_IN_TOKEN_TTL = 2 * 60 * 1000

// The expiry of a new sign-in token, ms since the epoch
export function signInTokenExpiry(): number {
  return Date.now() + SIGN_IN_TOKEN_TTL
}

export interface OAuth2Profile {
  email?: unknown
  email_verified?: unknown
}

// isEmailAllowed <email> [domain]: the email is in the domain (`example.com` or `@example.com`), any
// email without a domain
export function isEmailAllowed(email: unknown, domain?: string): email is string {
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    return false
  }
  var allowed = String(domain || '').trim().replace(/^@/, '').toLowerCase()
  return !allowed || email.toLowerCase().endsWith('@' + allowed)
}

// isEmailVerified <profile>: the provider did not report the email as unverified
export function isEmailVerified(profile: OAuth2Profile): boolean {
  var verified = profile.email_verified
  return verified !== false && String(verified).toLowerCase() !== 'false'
}

export default {SIGN_IN_TOKEN_TTL, signInTokenExpiry, isEmailAllowed, isEmailVerified}
