const logger = require('../../../util/logger')
const Promise = require('bluebird')

const request = require('request')
const _ = require('lodash')
const url = require('url')
const util = require('util')
const syrup = require('stf-syrup')
const wire = require('../../../wire')
const wirerouter = require('../../../wire/router')
const wireutil = require('../../../wire/util')
const iosutil = require('../../../util/iosutil')

module.exports = syrup.serial()
  .dependency(require('./solo'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../support/sub'))
  .dependency(require('./wda/WdaClient'))
  .define((options, solo, router, push, sub, wdaClient) => {
    const log = logger.createLogger('wda:client')
    function getTimestamp() {
      return (new Date()).getTime()
    }

    try {
      const Wda = {}

      Wda.connect = (port) => {
          const wdaPort = port || options.wdaServerPort

          return wdaClient.connect(wdaPort)
            .then(result => {
              return wdaClient.size()
            })
            .then(response => {
              const deviceSize = _.pick(response, ['height', 'width'])

              push.send([
                wireutil.global,
                wireutil.envelope(new wire.SizeIsoDevice(
                  options.serial,
                  deviceSize.height,
                  deviceSize.width
                ))
              ])

              wdaClient.batteryIosEvent()
                .then(response => {
                  push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.BatteryIosEvent(
                      options.serial,
                      parseInt(response.value.state),
                      parseInt(response.value.level * 100)
                    ))
                  ])
                })
                .catch(err => {
                  log.info(err)
                })
              wdaClient.sdkVersion()
              .then(response => {
                push.send([
                  wireutil.global,
                  wireutil.envelope(new wire.SdkIosVersion(
                    options.serial,
                    response.value.capabilities.device,
                    response.value.capabilities.sdkVersion
                  ))
                ])
              })
              .catch(err => {
                log.info(err)
              })

              sub.on('message', wirerouter()
                .on(wire.KeyPressMessage, (channel, message) => {
                  wdaClient.homeBtn()
                    .then(response => {
                      log.info('Home button response: ', response)
                    })
                    .catch(err => {
                      log.error('Home button failed to execute with error: ', err)
                    })
                })
                .on(wire.TouchDownIosMessage, (channel, message) => {
                  wdaClient.tap(message)
                })
                .on(wire.TouchMoveIosMessage, (channel, message) => {
                  wdaClient.swipe(message, deviceSize)
                })
                .on(wire.TypeMessage, (channel, message) => {
                  wdaClient.typeKey({value: [iosutil.asciiparser(message.text)]})
                })
                .on(wire.KeyDownMessage, (channel, message) => {
                  wdaClient.typeKey({value: [iosutil.asciiparser(message.key)]})
                })
                .on(wire.BrowserOpenMessage, (channel, message) => {
                  wdaClient.openUrl(message)
                })
                .on(wire.RotateMessage, (channel, message) => {
                  const rotation = iosutil.degreesToOrientation(message.rotation)
                  wdaClient.rotation({orientation: rotation})
                    .then(result => {
                      push.send([
                        wireutil.global,
                        wireutil.envelope(new wire.RotationEvent(
                          options.serial,
                          message.rotation
                        ))
                      ])
                    })
                    .catch(err => {
                      log.error('Failt to rotate device to : ', rotation)
                    })
                })
                .on(wire.TouchUpMessage, (channel, message) => {
                  wdaClient.touchUp(deviceSize)
                })
                .on(wire.ScreenCaptureMessage, (channel, message) => {
                  wdaClient.screenshot()
                    .then(response => {
                      let reply = wireutil.reply(options.serial)
                      let args = {
                          url: url.resolve(options.storageUrl, util.format('s/upload/%s', 'image'))
                        }

                      const imageBuffer = new Buffer(response.value, 'base64')

                      let req = request.post(args, function(err, res, body) {
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
            })
            .catch(err => {
              return Promise.reject()
            })
            .finally(() => {
              return Promise.resolve()
            })
      }

      return Wda
    } catch(e) {
      log.error('Failed to execute wda plugin with exception :', e)
    }

  })
