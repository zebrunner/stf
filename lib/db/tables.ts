/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import r from 'rethinkdb'
import type {DbTableSpec} from '../types/stf.js'

export default {
  users: {
    primaryKey: 'email'
  , indexes: {
      adbKeys: {
        indexFunction: function(user) {
          return user('adbKeys')('fingerprint')
        }
      , options: {
          multi: true
        }
      }
    }
  }
, accessTokens: {
    primaryKey: 'id'
  , indexes: {
      email: null
    }
  }
  // Fork (Zebrunner): the sessions of lib/util/authsession.ts
, sessions: {
    primaryKey: 'id'
  , indexes: {
      email: null
    }
  }
, vncauth: {
    primaryKey: 'password'
  , indexes: {
      response: null
    , responsePerDevice: {
        indexFunction: function(row) {
          return [row('response'), row('deviceId')]
        }
      }
    }
  }
, devices: {
    primaryKey: 'serial'
  , indexes: {
      owner: {
        indexFunction: function(device) {
          return r.branch(
            device('present')
          , device('owner')('email')
          , r.literal()
          )
        }
      }
    , logs_enabled: false
    , present: null
    , providerChannel: {
        indexFunction: function(device) {
          return device('provider')('channel')
        }
      }
    , group: {
        indexFunction: function(device) {
          return device('group')('id')
        }
      }
      // Fork (Zebrunner): the enrolled node of a device, lib/db/zebrunner-nodes.ts
    , node: null
    }
  }
, logs: {
    primaryKey: 'id'
  }
, groups: {
    primaryKey: 'id'
  , indexes: {
        privilege: null
      , owner: {
          indexFunction: function(group) {
            return group('owner')('email')
          }
        }
      , startTime: {
          indexFunction: function(group) {
            return group('dates').nth(0)('start')
          }
        }
    }
  }
  // Fork (Zebrunner): the enrolled device hosts and their invites, lib/db/zebrunner-nodes.ts
, nodes: {
    primaryKey: 'label'
  , indexes: {
      address: null
    }
  }
, node_invites: {
    primaryKey: 'hash'
  , indexes: {
      label: null
    }
  }
} as Record<string, DbTableSpec>
