/**
* Fork (Zebrunner): the rules of the sign-in units that hand the user to the app with a token in its
* URL (auth-oauth2, auth-mock, as auth-ldap and auth-zebrunner do).
*
* - the token expires in two minutes: the app takes it over at once, a URL may stay in logs;
* - an OAuth2 user needs an email of the allowed domain (`user@example.com` for `example.com`, not
*   `user@evil-example.com`) that the provider reports as verified (`email_verified: true` of OpenID
*   Connect, `verified_email: true` of the v1/v2 user info of Google): an unverified email could be
*   the one of somebody else, e.g. of the admin. A provider that never says it (GitHub, the user info
*   of Azure AD) needs --oauth-allow-missing-email-verified, which takes a profile without either
*   field; a profile that says false is refused whatever the option.
**/

export const SIGN_IN_TOKEN_TTL = 2 * 60 * 1000

// The expiry of a new sign-in token, ms since the epoch
export function signInTokenExpiry(): number {
  return Date.now() + SIGN_IN_TOKEN_TTL
}

export interface OAuth2Profile {
  email?: unknown
  email_verified?: unknown
  verified_email?: unknown
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

function isMissing(value: unknown): boolean {
  return typeof value === 'undefined' || value === null
}

// isEmailVerified <profile> [allowMissing]: the provider reports the email as verified (true or
// "true"); with allowMissing also a profile that does not say it
export function isEmailVerified(profile: OAuth2Profile, allowMissing = false): boolean {
  var verified = isMissing(profile.email_verified) ? profile.verified_email : profile.email_verified
  if (isMissing(verified)) {
    return allowMissing
  }
  return verified === true || String(verified).toLowerCase() === 'true'
}

export default {SIGN_IN_TOKEN_TTL, signInTokenExpiry, isEmailAllowed, isEmailVerified}
