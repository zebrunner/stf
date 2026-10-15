// Fork (Zebrunner): helpers of the tests of test/units/zebrunner/
import http from 'node:http'
import type {AddressInfo} from 'node:net'

import cookieSession from 'cookie-session'
import express from 'express'
import sinon from 'sinon'

import {importFresh} from './module-mock.mts'

export interface Running {
  origin: string
  close(): Promise<void>
}

function running(server: http.Server, host = '127.0.0.1'): Running {
  return {
    origin: 'http://' + (host.includes(':') ? '[' + host + ']' : host) + ':' +
      (server.address() as AddressInfo).port
  , close: function() {
      return new Promise<void>(function(resolve) {
        server.closeAllConnections()
        server.close(function() {
          resolve()
        })
      })
    }
  }
}

// listen <handler> [host]: serves the handler on a free port of the host
export function listen(handler: http.RequestListener, host = '127.0.0.1'): Promise<Running> {
  var server = http.createServer(handler)
  return new Promise<Running>(function(resolve) {
    server.listen(0, host, function() {
      resolve(running(server, host))
    })
  })
}

// startUnit <unit> <options>: starts a unit that creates its own server on options.port
export async function startUnit(unit: URL, options: Record<string, unknown>): Promise<Running> {
  var server: http.Server | undefined
  var createServer = http.createServer
  var capture = sinon.stub(http, 'createServer').callsFake(function(app) {
    server = (createServer as (handler: unknown) => http.Server)(app)
    return server
  })
  try {
    var module = await importFresh(unit)
    module.default(Object.assign({port: 0}, options))
  }
  finally {
    capture.restore()
  }
  if (!server) {
    throw new Error('The unit did not create a server')
  }
  var started = server
  if (!started.listening) {
    await new Promise<void>(function(resolve) {
      started.once('listening', resolve)
    })
  }
  return running(started)
}

// sessionCookie <secret> <session>: the cookie header of a session of the app unit
export async function sessionCookie(secret: string, session: object, name = 'ssid') {
  var app = express()
  app.use(cookieSession({name: name, keys: [secret]}))
  app.get('/', function(req, res) {
    Object.assign(req.session!, session)
    res.end()
  })
  var server = await listen(app)
  try {
    var res = await fetch(server.origin + '/')
    return res.headers.getSetCookie().map(function(cookie) {
      return cookie.split(';')[0]
    }).join('; ')
  }
  finally {
    await server.close()
  }
}
