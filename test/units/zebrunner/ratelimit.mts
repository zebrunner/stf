// Fork (Zebrunner): the limit of failed sign-ins, lib/util/ratelimit.ts
import {expect} from 'chai'
import express from 'express'

import ratelimit from '../../../lib/util/ratelimit.js'
import {listen, type Running} from '../../helpers/zebrunner.mts'

describe('zebrunner: ratelimit', function() {
  var server: Running

  before(async function() {
    var app = express()
    app.use(express.json())
    app.post('/signin', ratelimit({window: 60000, maxAttempts: 3, lockout: 200, maxLockout: 300})
    , function(req, res) {
        if (req.body.password === 'down') {
          res.status(503).json({success: false})
        }
        else if (req.body.password === 'right') {
          res.json({success: true})
        }
        else {
          res.status(400).json({success: false})
        }
      })
    server = await listen(app)
  })

  after(async function() {
    await server.close()
  })

  function signIn(username: string, password: string, forwardedFor?: string) {
    return fetch(server.origin + '/signin', {
      method: 'POST'
    , headers: Object.assign(
        {'content-type': 'application/json'}
      , forwardedFor ? {'x-forwarded-for': forwardedFor} : {}
      )
    , body: JSON.stringify({username: username, password: password})
    })
  }

  async function statuses(username: string, password: string, count: number) {
    var result = []
    for (var i = 0; i < count; i++) {
      result.push((await signIn(username, password)).status)
    }
    return result
  }

  it('should lock a user out after the failed attempts', async function() {
    expect(await statuses('alice', 'wrong', 3)).to.eql([400, 400, 400])
    var locked = await signIn('alice', 'right')
    expect(locked.status).to.equal(429)
    expect(locked.headers.get('retry-after')).to.equal('1')
    expect(await locked.json()).to.include({error: 'TooManyRequestsError'})
  })

  it('should not lock the other users out', async function() {
    expect((await signIn('bob', 'right')).status).to.equal(200)
  })

  it('should let the user in after the lockout, locking twice as long next', async function() {
    await new Promise(function(resolve) {
      setTimeout(resolve, 250)
    })
    expect(await statuses('alice', 'wrong', 3)).to.eql([400, 400, 400])
    await new Promise(function(resolve) {
      setTimeout(resolve, 250)
    })
    expect((await signIn('alice', 'right')).status).to.equal(429)
    await new Promise(function(resolve) {
      setTimeout(resolve, 100)
    })
    expect((await signIn('alice', 'right')).status).to.equal(200)
  })

  it('should forget the failures after a successful sign-in', async function() {
    expect(await statuses('carol', 'wrong', 2)).to.eql([400, 400])
    expect((await signIn('carol', 'right')).status).to.equal(200)
    expect(await statuses('carol', 'wrong', 2)).to.eql([400, 400])
    expect((await signIn('carol', 'right')).status).to.equal(200)
  })

  it('should not count the failures of the identity service', async function() {
    expect(await statuses('dave', 'down', 4)).to.eql([503, 503, 503, 503])
    expect((await signIn('dave', 'right')).status).to.equal(200)
  })

  it('should not let a client pick its address with X-Forwarded-For', async function() {
    for (var i = 0; i < 3; i++) {
      await signIn('erin', 'wrong', '10.0.0.' + i)
    }
    expect((await signIn('erin', 'right', '10.0.0.99')).status).to.equal(429)
  })
})
