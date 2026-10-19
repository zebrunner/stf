import {Transform} from 'stream'

import syrup from '@devicefarmer/stf-syrup'
import {WebSocketServer} from 'ws'
import websocketStream from 'websocket-stream'
import MjpegConsumer from 'mjpeg-consumer'
import Promise from 'bluebird'
import request from '@cypress/request'

import logger from '../../../../util/logger.js'
import iosutil from '../util/iosutil.js'
import type {
  IosDeviceOptions
, IosNotifierPlugin
, IosSoloPlugin
, WdaClientPlugin
} from '../../../../types/ios-device.js'
import soloSyrup from '../solo.js'
import notifierSyrup from '../devicenotifier.js'
import wdaClientSyrup from '../wda/WdaClient.js'
import pushSyrup from '../../support/push.js'

const HEARTBEAT_INTERVAL_MS = 30000

interface StreamAttemptResult {
  response: NodeJS.ReadableStream
  frameStream: request.Request
}

export default syrup.serial()
  .dependency(soloSyrup)
  .dependency(notifierSyrup)
  .dependency(wdaClientSyrup)
  .dependency(pushSyrup)
  .define(function(
    options: IosDeviceOptions
  , _solo: IosSoloPlugin
  , notifier: IosNotifierPlugin
  , WdaClient: WdaClientPlugin
  , _push: unknown
  ) {
    var log = logger.createLogger('device:plugins:screen:stream')
    var wss = new WebSocketServer({port: options.screenPort})
    var targetUrl = iosutil.getUri(options.wdaHost, options.mjpegPort || options.connectPort)

    wss.on('connection', function(ws: import('ws').WebSocket) {
      var isConnectionAlive = true
      var isPongReceived = true
      var consumer = new MjpegConsumer()
      var frameStream: request.Request | null = null
      var chain = Promise.resolve()
      var stream = websocketStream(ws)

      // Fork (Zebrunner): a browser that is gone without closing its socket is noticed by the missed pong
      var heartbeat = setInterval(function() {
        if (!isPongReceived) {
          log.important('ws heartbeat timeout')
          ws.terminate()
          return
        }
        isPongReceived = false
        ws.ping()
      }, HEARTBEAT_INTERVAL_MS)

      ws.on('pong', function() {
        isPongReceived = true
      })

      // Fork (Zebrunner): the MJPEG request outlives the socket of the browser unless it is aborted. WDA
      // then queues every frame for a client that never reads them and grows until iOS kills it.
      function closeFrameStream() {
        clearInterval(heartbeat)
        if (frameStream) {
          frameStream.abort()
          frameStream = null
        }
      }

      function handleSocketError(err: unknown, message: string) {
        if (!isConnectionAlive) {
          return
        }
        log.error(message, err)
        notifier.setDeviceTemporaryUnavailable(err)
        ws.close()
      }

      function handleRequestStream() {
        return new Promise<void>(function(resolve, reject) {
          setTimeout(function() {
            if (!isConnectionAlive) {
              reject()
              return
            }
            frameStream = request.get(targetUrl)

            frameStream.on('response', function(response) {
              reject({response: response, frameStream: frameStream} as StreamAttemptResult)
            })
            frameStream.on('error', function() {
              if (isConnectionAlive) {
                resolve()
              }
              else {
                reject()
              }
            })
          }, 1000)
        })
      }

      function getRequestStream() {
        for (var i = 0; i < 10; i++) {
          chain = chain.then(function() {
            return handleRequestStream()
          })
        }

        chain
          .then(function() {
            return handleSocketError(
              {message: 'Connection failed to WDA MJPEG port'}
            , 'Consumer error'
            )
          })
          .catch(function(result: StreamAttemptResult | undefined) {
            if (result) {
              if (!isConnectionAlive) {
                result.frameStream.abort()
                return
              }
              var transformStream = new Transform({
                transform(chunk, _encoding, callback) {
                  if (WdaClient.isSwiping) {
                    ws.send(JSON.stringify({type: 'swiping', message: 'Swiping detected'}))
                  }
                  callback(null, chunk)
                }
              })

              result.response.pipe(consumer).pipe(transformStream).pipe(stream)

              WdaClient.startSession()

              result.frameStream.on('error', function(err) {
                handleSocketError(err, 'frameStream error')
              })
            }
          })
      }

      consumer.on('error', function(err: Error) {
        handleSocketError(err, 'Consumer error')
      })

      stream.on('error', function(_err) {
      })

      stream.socket.on('error', function(_err) {
      })

      ws.on('close', function() {
        WdaClient.stopSession()
        isConnectionAlive = false
        closeFrameStream()
        log.important('ws on close event')
      })
      ws.on('error', function() {
        WdaClient.stopSession()
        isConnectionAlive = false
        closeFrameStream()
        log.important('ws on error event')
      })

      getRequestStream()
    })
  })
