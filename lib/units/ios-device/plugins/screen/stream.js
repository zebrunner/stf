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

        frameStream.on('error', function(err) {
          log.error('frameStrem error ', err)
          notifier.setDeviceTemporaryUnavialable()

          ws.close()
        })

        consumer.on('error', err => {
          log.error('Consumer error', err)
          ws.close()
        })

        stream.on('error', err => {
          log.error('Stream error ', err)
          ws.close()
        })

        stream.socket.on('error', err => {
          log.error('Websocket stream error ', err)

          ws.close()
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
