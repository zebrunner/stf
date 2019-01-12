const syrup = require('stf-syrup')
const webSocketServer = require('ws')
const websocketStream = require('websocket-stream')
const MjpegConsumer = require('mjpeg-consumer')
const Streamutil = require('../util/streamutil')
const request = require('request')
const logger = require('../../../../util/logger')
const iputil = require('../util/iputil')
const lifecycle = require('../../../../util/lifecycle')
const client = {}
const USER = 'user'


module.exports = syrup.serial()
  .dependency(require('../../support/push'))
  .dependency(require('../../support/sub'))
  .dependency(require('../wda'))
  .dependency(require('../solo'))
  .define(function(options, push, sub, wda, solo) {
      const log = logger.createLogger('device:plugins:screen:stream')
      const ip = iputil(options.serial)
      const wss = new webSocketServer.Server({port: options.screenPort})
      const url = `http://${ip}:${options.connectPort}`
      wss.on('connection', (ws) => {
        ws.isAlive = true

        const consumer = new MjpegConsumer()
        const frameStream = request.get(url)
        let stream = websocketStream(ws)

        frameStream.on('error', function(err) {
          log.error('frameStrem error ', err)
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
        } catch(e) {
          log.error('Catch stream exception ', e)
          ws.close()
          solo.poke()
        }

        ws.on('close', function(data) {
          // @TODO handle close event
          //stream.socket.onclose()
        })
        ws.on('error', function() {
          // @TODO handle error event
          //stream.socket.onclose()
        })
      })

  })
