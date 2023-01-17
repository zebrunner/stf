const logger = require('../../../util/logger')
const Promise = require('bluebird')
const request = require('request')
const _ = require('lodash')
const url = require('url')
const util = require('util')
const syrup = require('@devicefarmer/stf-syrup')
const wire = require('../../../wire')
const wirerouter = require('../../../wire/router')
const wireutil = require('../../../wire/util')
const iosutil = require('./util/iosutil')

module.exports = syrup.serial()
  .dependency(require('../support/push'))
  .dependency(require('../support/sub'))
  .dependency(require('./wda/WdaClient'))
  .define((options, push, sub, wdaClient) => {
  const log = logger.createLogger('wda:client')
  const Wda = {}

  Wda.connect = () => {
    sub.on('message', wirerouter()
      .on(wire.KeyPressMessage, (channel, message) => {
        iosutil.pressButton.call(wdaClient, message.key)
      })
      .on(wire.GetIosTreeElements, (channel, message) => {
        wdaClient.getTreeElements()
          .then(response => {
            const reply = wireutil.reply(options.serial)
            push.send([
              channel,
              reply.tree(null, response)
            ])
          })
          .catch(err => {
            log.error('Failed to get device tree elements with error ', err)
          })
        // @TODO add transaction for getting tree elements
      })
      .on(wire.StoreOpenMessage, (channel, message) => {
        wdaClient.appActivate('com.apple.AppStore')
      })
      .on(wire.DashboardOpenMessage, (channel, message) =>{
        wdaClient.appActivate('com.apple.Preferences')
      })
      .on(wire.TouchDownIosMessage, (channel, message) => {
        wdaClient.tap(message)
      })
      .on(wire.TapDeviceTreeElement, (channel, message) => {
        wdaClient.tapDeviceTreeElement(message)
      })
      .on(wire.TouchMoveIosMessage, (channel, message) => {
        wdaClient.swipe(message)
      })
      .on(wire.TypeMessage, (channel, message) => {
        log.verbose("wire.TypeMessage: ", message)
        wdaClient.typeKey({value: [iosutil.asciiparser(message.text)]})
      })
      .on(wire.BrowserOpenMessage, (channel, message) => {
        wdaClient.openUrl(message)
      })
      .on(wire.RotateMessage, (channel, message) => {
        const rotation = iosutil.degreesToOrientation(message.rotation)
        wdaClient.rotation({orientation: rotation})
          .then(() => {
            push.send([
              wireutil.global,
              wireutil.envelope(new wire.RotationEvent(
                options.serial,
                message.rotation
              ))
            ])
          })
          .catch(err => {
            log.error('Failed to rotate device to : ', rotation, err)
          })
      })
      .on(wire.TouchUpMessage, (channel, message) => {
        wdaClient.touchUp()
      })
      .on(wire.ScreenCaptureMessage, (channel, message) => {
        wdaClient.screenshot()
          .then(response => {
            let reply = wireutil.reply(options.serial)
            let args = {
                url: url.resolve(options.storageUrl, util.format('s/upload/%s', 'image'))
              }

            const imageBuffer = new Buffer(response.value, 'base64')

            let req = request.post(args, (err, res, body) => {
              try {
                let result = JSON.parse(body)
                push.send([
                  channel
                  , reply.okay('success', result.resources.file)
                ])
              }
              catch (err) {
                log.error('Invalid JSON in response', err.stack, body)
              }
            })
            req.form().append('file', imageBuffer, {
              filename: util.format('%s.png', options.serial),
              contentType: 'image/png'
            })
          })
          .catch(err => {
            log.error('Failed to get screenshot', err)
          })
      })
      .handler())

    return Promise.resolve()
  }

  return Wda
})
