const syrup = require('@devicefarmer/stf-syrup')
const webSocketServer = require('ws')
const websocketStream = require('websocket-stream')
const MjpegConsumer = require('mjpeg-consumer')
const Promise = require('bluebird')
const request = require('request')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')

const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')

module.exports = syrup.serial()
  .dependency(require('../solo'))
  .dependency(require('../devicenotifier'))
  .dependency(require('../wda/WdaClient'))
  .dependency(require('../../support/push'))
  .define(function(options, solo, notifier, WdaClient, push) {
      const log = logger.createLogger('device:plugins:screen:stream')
      const wss = new webSocketServer.Server({port: options.screenPort})

      let url = iosutil.getUri(options.wdaHost, options.mjpegPort || options.connectPort)
      wss.on('connection', (ws) => {
        ws.isAlive = true
        let isConnectionAlive = true

        const consumer = new MjpegConsumer()
        let frameStream
        let chain = Promise.resolve()
        let stream = websocketStream(ws)

        function handleSocketError(err, message) {
          log.error(message, err)
          notifier.setDeviceTemporaryUnavialable(err)
          ws.close()
        }

        const handleRequestStream = () => {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              frameStream = request.get(url)

              frameStream.on('response', response => {
                reject({response, frameStream})
              })
              frameStream.on('error', err => {
                // checking for ws connection in order to stop chain promise if connection closed
                if (isConnectionAlive) {
                  resolve()
                } else {
                  reject()
                }
              })
            }, 1000)
          })
        }

        const getRequestStream = () => {
          for(let i = 0; i < 10; i++) {
            chain = chain.then(() => handleRequestStream())
          }

          chain
            .then(() => handleSocketError({message: 'Connection failed to WDA MJPEG port'}, 'Consumer error'))
            .catch(result => {
              if(result) {
                result.response.pipe(consumer).pipe(stream)
                //[VD] We can't launch homeBtn otherwise opening in STF corrupt test automation run. Also no sense to execute connect
                WdaClient.startSession()
                //WdaClient.homeBtn() //no existing session detected so we can press home button to wake up device automatically

                // override already existing error handler
                result.frameStream.on('error', function(err) {
                  handleSocketError(err, 'frameStream error ')
                })
              }
            })
        }

        consumer.on('error', err => {
          handleSocketError(err, 'Consumer error')
          //doConnectionToMJPEGStream(fn)
        })

        stream.on('error', err => {
          //handleSocketError(err, 'Stream error ')
        })

        stream.socket.on('error', err => {
          //handleSocketError(err, 'Websocket stream error ')
        })

        ws.on('close', function() {
          // @TODO handle close event
          //stream.socket.onclose()
          WdaClient.stopSession()
          isConnectionAlive = false
          log.important('ws on close event')
        })
        ws.on('error', function() {
          // @TODO handle error event
          //stream.socket.onclose()
          WdaClient.stopSession()
          isConnectionAlive = false
          log.important('ws on error event')
        })

        getRequestStream()
      })
  })
