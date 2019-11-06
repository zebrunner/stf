const syrup = require('stf-syrup')
const webSocketServer = require('ws')
const websocketStream = require('websocket-stream')
const MjpegConsumer = require('mjpeg-consumer')
const request = require('request')
const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')


module.exports = syrup.serial()
  .dependency(require('../solo'))
  .dependency(require('../devicenotifier'))
  .define(function(options, solo, notifier) {
      const log = logger.createLogger('device:plugins:screen:stream')
      const wss = new webSocketServer.Server({port: options.screenPort})

      let url = iosutil.getUri(options, options.connectPort, log)
      wss.on('connection', (ws) => {
        ws.isAlive = true

        const consumer = new MjpegConsumer()
        const frameStream = request.get(url)
        let stream = websocketStream(ws)

        function handleSocketError(err, message) {
          log.error(message, err)
          notifier.setDeviceTemporaryUnavialable()
          ws.close()
        }

        frameStream.on('error', function(err) {
          handleSocketError('frameStrem error ', err)
        })

        consumer.on('error', err => {
          handleSocketError('Consumer error', err)
        })

        stream.on('error', err => {
          handleSocketError('Stream error ', err)
        })

        stream.socket.on('error', err => {
          handleSocketError('Websocket stream error ', err)
        })

        try {
          frameStream.pipe(consumer).pipe(stream)
        }
        catch(e) {
          log.error('Catch stream exception ', e)
          ws.close()
          solo.poke()
        }

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
