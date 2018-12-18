const syrup = require('stf-syrup')
const webSocketServer = require('ws')
const websocketStream = require('websocket-stream')
const Promise = require('bluebird')
const MjpegConsumer = require('mjpeg-consumer')
const wire = require('../../../../wire')
const wirerouter = require('../../../../wire/router')
const wireutil = require('../../../../wire/util')
const request = require('request')

const logger = require('../../../../util/logger')
const ip = require('ip')
const lifecycle = require('../../../../util/lifecycle')


module.exports = syrup.serial()
  // .dependency(require('./options'))
  .dependency(require('../../support/push'))
  .dependency(require('../../support/sub'))
  .dependency(require('../wda'))
  .define(function(options, push, sub, wda) {
    const log = logger.createLogger('device:plugins:screen:stream')
    const ipAddr = ip.address()
    const wdaUri = `http://192.168.0.123`

    try {
      const wss = new webSocketServer.Server({port: options.screenPort})
      const consumer = new MjpegConsumer()

      // function startStream() {
      wss.on('connection', (ws) => {
        const stream = websocketStream(ws)
        request.get(wdaUri + ':9100').pipe(consumer).pipe(stream)
        ws.on('close', (data) => {
          log.error('stream process was interrupted with data : ', data)
        })

        ws.on('error', err => {
          log.error('stream process was interrupted with err :', err)
        })
      })
    } catch(e) {
      log.error('Failed to execute wda plugin with exception', e)
    }
  })
