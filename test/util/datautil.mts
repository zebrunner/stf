import * as chai from 'chai'
var expect = chai.expect

import datautil from '../../lib/util/datautil.js'
import type deviceutil from '../../lib/util/deviceutil.js'

type Claim = {email: string, expiresAt: number}

describe('datautil', function() {
  describe('normalize', function() {
    var user: deviceutil.Viewer = {email: 'user@example.com', privilege: 'user'}

    function device(restoreOwner: Claim | null): datautil.Device & {ready: boolean} {
      return {
        present: true
      , ready: true
      , group: {id: 'group1'}
      , owner: null
      , restoreOwner: restoreOwner
      }
    }

    // normalize enriches rather than whitelists and every device response goes through it, so a
    // claim naming a user would otherwise be handed to anyone who can see the device
    it('should never let the held-for user leave the server', function() {
      var held = device({email: 'someone@example.com', expiresAt: Date.now() + 60000})
      datautil.normalize(held, user)
      expect(held).to.not.have.property('restoreOwner')
      expect(held.claimed).to.be.true
    })

    // isAddable reads `claimed`, and the expiry is judged nowhere else on that path, so an expired
    // claim left reading as held would keep a device untakeable until it next became ready
    it('should stop reporting a device as held once the claim expires', function() {
      var stale = device({email: 'someone@example.com', expiresAt: Date.now() - 1})
      datautil.normalize(stale, user)
      expect(stale.claimed).to.be.false
      expect(stale).to.not.have.property('restoreOwner')
    })

    it('should report an unclaimed device as not held', function() {
      var free = device(null)
      datautil.normalize(free, user)
      expect(free.claimed).to.be.false
    })

    // Fork (Zebrunner): the host of the device went away during a session, the device stays
    // controlled; the API answered `owner: null` with `using: true` to an admin
    describe('of an absent device with an owner', function() {
      var owner = {email: 'owner@example.com', name: 'Owner'}

      function absent(): datautil.Device {
        return {present: false, group: {id: 'group1'}, owner: {...owner}}
      }

      it('should keep the owner for an admin and the owner, consistent with `using`', function() {
        var admin: deviceutil.Viewer = {email: 'admin@example.com', privilege: 'admin'}
        var viewers: deviceutil.Viewer[] = [admin, {email: owner.email, privilege: 'user'}]
        viewers.forEach(function(viewer) {
          var seen = absent()
          datautil.normalize(seen, viewer)
          expect(seen.owner, viewer.email).to.deep.equal(owner)
          expect(seen.using, viewer.email).to.be.true
        })
      })

      it('should hide the owner from the other users', function() {
        var seen = absent()
        datautil.normalize(seen, user)
        expect(seen.owner).to.be.null
        expect(seen.using).to.be.false
      })
    })
  })
})
