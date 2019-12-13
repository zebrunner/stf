const syrup = require('stf-syrup')
const events = require('events')
const webSocketServer = require('ws')
const websocketStream = require('websocket-stream')
const MjpegConsumer = require('mjpeg-consumer')
const Promise = require('bluebird')
const request = require('request')

const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')

module.exports = syrup.serial()
  .dependency(require('../solo'))
  .dependency(require('../devicenotifier'))
  .define(function(options, solo, notifier) {
      const log = logger.createLogger('device:plugins:screen:stream')
      const wss = new webSocketServer.Server({port: options.screenPort})
      const waiter = new events.EventEmitter()

      let url = iosutil.getUri(options.wdaHost, options.mjpegPort || options.connectPort)
      wss.on('connection', (ws) => {
        ws.isAlive = true

        const consumer = new MjpegConsumer()
        let frameStream
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
              log.info('executed handleRequestStream')

              frameStream.on('response', response => {
                reject({response, frameStream})
              })
              frameStream.on('error', err => {
                resolve()
              })
            }, 1000)
          })
        }

        const getRequestStream = () => {
          let chain = Promise.resolve()

          for(let i = 0; i < 10; i++) {
            chain = chain.then(() => handleRequestStream())
          }

          chain
            .then(() => handleSocketError({message: 'Connection failed to WDA MJPEG port'}, 'Consumer error'))
            .catch(result => {
              result.response.pipe(consumer).pipe(stream)

              // override already existing error handler
              result.frameStream.on('error', function(err) {
                //handleSocketError(err, 'frameStrem error ')
                getRequestStream()
              })
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

        getRequestStream()

        ws.on('close', function() {
          // @TODO handle close event
          //stream.socket.onclose()
        })
        ws.on('error', function() {
          // @TODO handle error event
          //stream.socket.onclose()
        })
      })
  })
