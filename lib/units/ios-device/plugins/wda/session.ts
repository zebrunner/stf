import Promise from 'bluebird'

import type {
  RpOptions
, WdaSessionResponse
, WdaStatusResponse
} from '../../../../types/ios-device.js'

export interface WdaSession {
  response: WdaSessionResponse
  // Whether the session was created here, so it is ours to delete
  created: boolean
}

type Send = <T>(options: RpOptions) => Promise<T>

// activeOrNewSession <baseUrl> <send>: the active WDA session, or a new one when there is none.
// Creating a session makes WDA kill the active one and terminate its app, which closed the app of
// a running Appium test whenever its device was opened in STF (zebrunner/stf#803, #822, #1031).
export default function activeOrNewSession(baseUrl: string, send: Send): Promise<WdaSession> {
  return send<WdaStatusResponse>({
    method: 'GET'
  , uri: `${baseUrl}/status`
  , json: true
  })
    .then(function(status): Promise<WdaSession> {
      if (status.sessionId) {
        return send<WdaSessionResponse>({
          method: 'GET'
        , uri: `${baseUrl}/session/${status.sessionId}`
        , json: true
        })
          .then(function(response): WdaSession {
            return {
              response: Object.assign({}, response, {sessionId: status.sessionId!})
            , created: false
            }
          })
      }
      return send<WdaSessionResponse>({
        method: 'POST'
      , uri: `${baseUrl}/session`
      , body: {capabilities: {}}
      , json: true
      })
        .then(function(response): WdaSession {
          return {response: response, created: true}
        })
    })
}
