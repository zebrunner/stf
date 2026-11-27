// Fork (Zebrunner): the access tokens kept as hashes, their expiry and the earlier documents until stf
// migrate hashed them (lib/util/zebrunner-access-tokens.ts)
import {expect} from 'chai'

import accessTokens from '../../../lib/util/zebrunner-access-tokens.js'
import jwtutil from '../../../lib/util/jwtutil.js'

var SECRET = 'units-secret'
var EMAIL = 'user@example.com'

describe('zebrunner: access tokens', function() {
  it('should make secrets of 64 hex characters and ids of their hashes', function() {
    var secret = accessTokens.newSecret()
    expect(secret).to.match(/^[0-9a-f]{64}$/)
    expect(accessTokens.newSecret()).to.not.equal(secret)
    var id = accessTokens.hashId(secret)
    expect(id).to.match(/^sha256:[0-9a-f]{64}$/)
    expect(id).to.not.include(secret)
    expect(accessTokens.isHashedId(id)).to.equal(true)
    expect(accessTokens.isHashedId(secret)).to.equal(false)
  })

  it('should take the user of a hashed document until its expiry', function() {
    var token = accessTokens.newDocument('s'.repeat(64), EMAIL, 'ci')
    expect(token).to.not.have.property('jwt')
    expect(token.expiresAt).to.equal(null)
    expect(accessTokens.emailOf(token, SECRET)).to.equal(EMAIL)
    var later = accessTokens.newDocument('s'.repeat(64), EMAIL, 'ci', new Date(Date.now() + 60000))
    expect(accessTokens.emailOf(later, SECRET)).to.equal(EMAIL)
    var past = accessTokens.newDocument('s'.repeat(64), EMAIL, 'ci', new Date(Date.now() - 1))
    expect(accessTokens.emailOf(past, SECRET)).to.equal(null)
    expect(accessTokens.emailOf(null, SECRET)).to.equal(null)
  })

  it('should treat an unreadable expiry as expired', function() {
    expect(accessTokens.isExpired({expiresAt: 'not a date'})).to.equal(true)
    expect(accessTokens.isExpired({expiresAt: null})).to.equal(false)
    expect(accessTokens.isExpired({})).to.equal(false)
  })

  it('should take the user of an earlier document from its JWT of the units secret', function() {
    var jwt = jwtutil.encode({payload: {email: EMAIL, name: 'user'}, secret: SECRET})
    var legacy = {id: 'c'.repeat(64), email: EMAIL, title: 'old', jwt: jwt}
    expect(accessTokens.emailOf(legacy, SECRET)).to.equal(EMAIL)
    expect(accessTokens.emailOf(legacy, 'another-secret')).to.equal(null)
    expect(accessTokens.emailOf({id: 'c'.repeat(64), email: EMAIL, title: 'old'}, SECRET))
      .to.equal(null)
  })

  it('should hash an earlier document without its JWT and keep its title and email', function() {
    var jwt = jwtutil.encode({payload: {email: EMAIL, name: 'user'}, secret: SECRET})
    var hashed = accessTokens.hashedDocument({
      id: 'c'.repeat(64), email: EMAIL, title: 'old', jwt: jwt
    })
    expect(hashed).to.deep.equal({
      id: accessTokens.hashId('c'.repeat(64)), email: EMAIL, title: 'old'
    , createdAt: null, expiresAt: null
    })
    expect(accessTokens.emailOf(hashed, SECRET)).to.equal(EMAIL)
  })

  it('should never look a hashed id up as an earlier document', function() {
    expect(accessTokens.isLegacySecret('d'.repeat(64))).to.equal(true)
    expect(accessTokens.isLegacySecret('an-old-token')).to.equal(true)
    expect(accessTokens.isLegacySecret(accessTokens.hashId('x'))).to.equal(false)
    expect(accessTokens.isLegacySecret('')).to.equal(false)
    expect(accessTokens.isLegacySecret(null)).to.equal(false)
  })

  it('should take a ttl of whole seconds between a minute and ten years', function() {
    expect(accessTokens.ttlError(null)).to.equal(null)
    expect(accessTokens.ttlError('')).to.equal(null)
    expect(accessTokens.ttlError(60)).to.equal(null)
    expect(accessTokens.ttlError(accessTokens.MAX_TTL_SECONDS)).to.equal(null)
    expect(accessTokens.ttlError(59)).to.be.a('string')
    expect(accessTokens.ttlError(accessTokens.MAX_TTL_SECONDS + 1)).to.be.a('string')
    expect(accessTokens.ttlError(61.5)).to.be.a('string')
    expect(accessTokens.ttlError('3600')).to.be.a('string')
    expect(accessTokens.expiryOf(null)).to.equal(null)
    expect(accessTokens.expiryOf(60, 1000)!.getTime()).to.equal(61000)
  })

  it('should publish the title and the expiry, the secret only when given', function() {
    var token = accessTokens.newDocument('e'.repeat(64), EMAIL, 'ci')
    expect(accessTokens.published(token)).to.deep.equal({title: 'ci', expiresAt: null})
    expect(accessTokens.published(token, 'e'.repeat(64)))
      .to.deep.equal({title: 'ci', expiresAt: null, id: 'e'.repeat(64)})
  })
})
