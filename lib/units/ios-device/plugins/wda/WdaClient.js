const net = require('net')
const request = require('request-promise')
const Promise = require('bluebird')
const syrup = require('@devicefarmer/stf-syrup')
const logger = require('../../../../util/logger')
const iosutil = require('../util/iosutil')
const wireutil = require('../../../../wire/util')
const wire = require('../../../../wire')
const lifecycle = require('../../../../util/lifecycle')
const {exec} = require('child_process')

const LOG_REQUEST_MSG = 'Request has been sent to WDA with data: '

module.exports = syrup.serial()
  .dependency(require('../devicenotifier'))
  .dependency(require('../../support/push'))
  .define((options, notifier, push) => {
    const log = logger.createLogger('wdaClient')
    log.info("WdaClient.js initializing...")

    const socket = new net.Socket()
    const WdaClient = {
      baseUrl: iosutil.getUri(options.wdaHost, options.wdaPort),
      sessionId: null,
      deviceSize: null,
      orientation: null,
      touchDownParams: {},
      isMove: false,
      tapStartAt: 0,
      typeKeyActions: [],
      typeKeyTimerId: null,
      typeKeyDelay: 250,

      startSession: function() {
        log.info('verifying wda session status...')

        const params = {
          capabilities: {},
        }

        this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session`,
          body: params,
          json: true,
        })
        .then(() => {
          return this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/status`,
            json: true,
          })
            .then((statusResponse) => {
              log.info(`status response: ${JSON.stringify(statusResponse)}`)

              // handles case of existing session
              if (statusResponse.sessionId) {
                this.sessionId = statusResponse.sessionId
                log.info(`reusing existing wda session: ${this.sessionId}`)
                if (options.deviceType !== 'tvOS') {
                  this.getOrientation()
                }
                return this.size()
              }

              log.info('starting wda session...')

              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session`,
                body: params,
                json: true,
              })
                .then((sessionResponse) => {
                  log.info(`startSession response: ${JSON.stringify(sessionResponse)}`)
                  // {"value":{"sessionId":"C4A07D30-E2E2-4922-9829-2B3ED2C4DBAE",
                  //    "capabilities":{"device":"iphone","browserName":" ","sdkVersion":"14.7.1","CFBundleIdentifier":"com.apple.springboard"}},
                  //    "sessionId":"C4A07D30-E2E2-4922-9829-2B3ED2C4DBAE"}

                  push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.SdkIosVersion(
                      options.serial,
                      sessionResponse.value.capabilities.device,
                      sessionResponse.value.capabilities.sdkVersion,
                    ))
                  ])
                  this.sessionId = sessionResponse.sessionId
                  // #284 send info about battery to STF db
                  log.info(`sessionId: ${this.sessionId}`)

                  // Prevent Apple TV disconnection
                  if (options.deviceType !== 'tvOS') {
                    this.getOrientation()
                    this.batteryIosEvent()
                  }

                  return this.size()
                })
                .catch((err) => {
                  log.error('"startSession" No valid response from web driver!', err)
                  return Promise.reject(err)
                })
            })
        })
      },
      stopSession: function() {
        log.info('stopping wda session: ', this.sessionId)
        let currentSessionId = this.sessionId
        this.sessionId = null

        if (currentSessionId == null) {
          //no sense to delete null (non existing session)
          return Promise.resolve()
        }

        this.handleRequest({
          method: 'DELETE',
          uri: `${this.baseUrl}/session/${currentSessionId}`
        })
      },
      typeKey: function(params) {

        // collect several chars till the space and do mass actions...
        if (!params.value || !params.value[0]) {
          return
        }

        const [value] = params.value

        // register keyDown and keyUp for current char
        this.typeKeyActions.push({type: 'keyDown', value})
        this.typeKeyActions.push({type: 'keyUp', value})



        const handleRequest = () => {
          const requestParams = {
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
            body: {
              actions: [
                {
                  type: 'key',
                  id: 'keyboard',
                  actions: this.typeKeyActions,
                }
              ]
            },
            json: true,
          }

          // reset this.typeKeyActions array as we are going to send word or char(s) by timeout
          this.typeKeyActions = []
          if (this.typeKeyTimerId) {
            // reset type key timer as we are going to send word or char(s) by timeout
            clearTimeout(this.typeKeyTimerId)
            this.typeKeyTimerId = null
          }

          if (options.deviceType !== 'tvOS') {
            return this.handleRequest(requestParams)
          } 

          // Apple TV keys 

          switch (true) {
            case value === '\v':
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: {name: "left"},
                json: true,
              })
              break;

            case value === '\f':
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: {name: "right"},
                json: true,
              })
              break;

            case value === '\0':
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: {name: "up"},
                json: true,
              })
              break;

            case value === '\x18':
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: {name: "down"},
                json: true,
              })
              break;

            case value === '\r':
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: {name: "select"},
                json: true,
              })
              break;

            default:
              break;
          }

        }

        if (value === ' ') {
          // as only space detected send full word to the iOS device
          handleRequest()
        }  else {
          //reset timer to start tracker again from the latest char. Final flush will happen if no types during this.typeKeyDelay ms
          if (this.typeKeyTimerId) {
            clearTimeout(this.typeKeyTimerId)
          }

          this.typeKeyTimerId = setTimeout(handleRequest, this.typeKeyDelay)
        }
      },

      tap: function(params) {
        this.tapStartAt = (new Date()).getTime()
        this.touchDownParams = params
        this.isMove = false
      },
      homeBtn: function() {
        if (options.deviceType !== 'tvOS') {
          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
            body: {name: "home"},
            json: true
          })
        } else {
          // #749: Fixing button action for AppleTV
          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
            body: {name: "menu"},
            json: true
          })
        }
      },
      swipe: function(params) {
        const scale = iosutil.swipe(this.orientation, params, this.deviceSize)
        const body = {
          actions: [
            {
              type: 'pointer',
              id: 'finger1',
              parameters: {pointerType: 'touch'},
              actions: [
                {type: 'pointerMove', duration: 0, x: scale.fromX, y: scale.fromY}, 
                {type: 'pointerMove', duration: scale.duration * 1000, x: scale.toX, y: (scale.fromY < scale.toY) ? scale.toY - (scale.toY / 4) : (scale.fromY - scale.toY >= 50 ? scale.toY + (scale.toY / 4) : scale.toY)},
                {type: 'pointerUp'},
              ],
            },
          ],
        }

        this.isMove = true

        if (options.deviceType === 'tvOS') {
          return log.error('Swipe is not supported')
        }

        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
          body,
          json: true,
        })
      },
      touchUp: function() {
        if (!this.isMove) {
          let {x, y} = this.touchDownParams

          x *= this.deviceSize.width
          y *= this.deviceSize.height

          log.info('X: ' + x, 'Y: ' + y)

          if(((new Date()).getTime() - this.tapStartAt) <= 1000 || !this.tapStartAt) {

            const body = {
                actions: [
                  {
                    type: 'pointer',
                    id: 'finger1',
                    parameters: {pointerType: 'touch'},
                    actions: [
                      {type: 'pointerMove', duration: 0, x, y},
                      {type: 'pointerMove', duration: 0, x, y},
                      {type: 'pointerUp'},
                    ],
                  },
                ],
              }

            if (options.deviceType !== 'tvOS') {
              log.info(options.deviceName)
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
                body,
                json: true,
              })
            // else if (deviceType === 'Watch_OS') {...}  
            } else {
              // Avoid crash, wait until width/height values are available
              if (x >= 0 && y >= 0) {
                switch (true) {
                  case x < 300:
                    return this.handleRequest({
                      method: 'POST',
                      uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                      body: {name: "left"},
                      json: true,
                    })
                  break;

                  case x > 1650:
                    return this.handleRequest({
                      method: 'POST',
                      uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                      body: {name: "right"},
                      json: true,
                    })
                  break;

                  case y > 850:
                    return this.handleRequest({
                      method: 'POST',
                      uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                      body: {name: "down"},
                      json: true,
                    })
                  break;

                  case y < 250:
                    return this.handleRequest({
                      method: 'POST',
                      uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                      body: {name: "up"},
                      json: true,
                    })
                  break;

                  default:
                    return this.handleRequest({
                      method: 'POST',
                      uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                      body: {name: "select"},
                      json: true,
                    })
                    break; 
                }
              }
            }
          }
          else {
            if (options.deviceType === 'tvOS') {
              return log.error('Holding tap is not supported')
            }
            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/touchAndHold`,
              body: {x, y, duration: 1},
              json: true,
            })
          }
        }
      },
      tapDeviceTreeElement: function(message) {
        const params = {
          using: 'link text',
          value: 'label=' + message.label,
        }

        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/elements`,
            body: params,
            json: true
          })
            .then(response => {
              const {ELEMENT} = response.value[0]
              return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/element/${ELEMENT}/click`,
                body: {},
                json: true
              })
            })
            .catch(err => {
              log.error(err)
            })
        })
      },
      doubleClick: function() {
        if(!this.isMove) {
          const {x, y} = this.touchDownParams
          const params = {
            x: x * this.deviceSize.width,
            y: y * this.deviceSize.height
          }

          return this.handleRequest({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/doubleTap`,
            body: params,
            json: true
          })
        }
      },
      size: function() {
        log.info('getting device window size...')

        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}/window/size`,
        })
          .then((windowSizeResponse) => {
            try {
              this.deviceSize = JSON.parse(windowSizeResponse).value
              let {height, width} = this.deviceSize

              return this.handleRequest({
                method: 'GET',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/screen`,
              })
                .then((wdaScreenResponse) => {
                  const {scale} = JSON.parse(wdaScreenResponse).value

                  height *= scale
                  width *= scale

                  push.send([
                      wireutil.global,
                      wireutil.envelope(new wire.SizeIosDevice(
                        options.serial,
                        height,
                        width,
                      ))
                    ])

                  return this.deviceSize
                })
            }
            catch (e) {
              throw new Error('Failed to parse json window size response object')
            }
          })
      },

      // #140 /url endpoint doesn't work in physical iOS devices
      // Using Siri is not efficient for opening url: https://github.com/appium/appium/issues/13975
      openUrl: function(message) {
        const params = {
          url: message.url
        }

        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/` + this.sessionId + `/url`,
          body: params,
          json: true
        })
      },
      screenshot: function() {
        return new Promise((resolve, reject) => {
          this.handleRequest({
            method: 'GET',
            uri: `${this.baseUrl}/screenshot`,
            json: true
          })
            .then(response => {
              try {
                resolve(response)
              } catch(e) {
                reject(e)
              }
            })
            .catch(err => reject(err))
        })
      },
      getOrientation: function() {

        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
          json: true
        }).then((orientationResponse) => {
          this.orientation = orientationResponse.value

          log.info('Current device orientation: ' + this.orientation)
        })
      },

      rotation: function(params) {
        this.orientation = params.orientation

        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
          body: params,
          json: true
        }).then(val => {
          this.getOrientation()

          this.size()

          let {height, width} = this.deviceSize

          return {height, width}
        })

      },
      batteryIosEvent: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/batteryInfo`,
          json: true,
        })
          .then((batteryInfoResponse) => {
            let status = '-'

            if (batteryInfoResponse.value.state === 3) {
              status = 'full'
            }
            if (batteryInfoResponse.value.state === 2) {
              status = 'charging'
            }
            push.send([
              wireutil.global,
              wireutil.envelope(new wire.BatteryIosEvent(
                options.serial,
                'good',
                'usb',
                status,
                parseInt(batteryInfoResponse.value.level * 100, 10),
                'n/a',
                100,
              ))
            ])
          })
          .catch((err) => log.info(err))
      },
      getTreeElements: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/source?format=json`,
          json: true
        })
      },
      pressButton: function(params) {
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
          body: {
            name: params
          },
          json: true
        })
      },
      appActivate: function(params) {
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/apps/activate`,
          body: {
            bundleId: params
          },
          json: true
        })
      },
      pressPower: function() {
        return this.handleRequest({
          method: 'GET',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/locked`,
          json: true
        })
          .then(response => {
            let url = ''
            if(response.value === true) {
              url = `${this.baseUrl}/session/${this.sessionId}/wda/unlock`
            } else {
              url = `${this.baseUrl}/session/${this.sessionId}/wda/lock`
            }
            return this.handleRequest({
              method: 'POST',
              uri: url,
              json: true
            })
          })
      },
      getClipBoard: function() {
        return this.handleRequest({
          method:'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/wda/getPasteboard`
        })
          .then(res => {
            let clipboard = Buffer.from(JSON.parse(res).value,'base64').toString('utf-8')
            return clipboard ? clipboard : 'No clipboard data'
          })
      },
      handleRequest: function(requestOpt) {
        return new Promise((resolve, reject) => {
          request(requestOpt)
            .then(response => {
              log.verbose(LOG_REQUEST_MSG, JSON.stringify(requestOpt))
              return resolve(response)
            })
            .catch(err => {
              recoverDevice()
              // #409: capture wda/appium crash asap and exit with status 1 from stf
              //notifier.setDeviceTemporaryUnavialable(err)
              notifier.setDeviceAbsent(err)
              lifecycle.fatal(err) // exit with error code 1 is the best way to activate valid auto-healing steps with container(s) restart
            })
        })
      },
    }


    /*
     * WDA MJPEG connection is stable enough to be track status wda server itself.
     * As only connection is closed or error detected we have to restart STF
    */
    function connectToWdaMjpeg() {
      console.log('connecting to WdaMjpeg')
      socket.connect(options.connectPort, options.wdaHost)
    }

    function wdaMjpegConnectEventHandler() {
      console.log(`Connected to WdaMjpeg ${options.wdaHost}:${options.connectPort}`)
    }

    function recoverDevice() {
      const UDID = process.env.DEVICE_UDID
      const UIDcommand = '`id -u`'
      const shellCommand = `launchctl kickstart gui/${UIDcommand}/com.zebrunner.mcloud.${UDID}`

      exec(shellCommand)
    }

    async function wdaMjpegCloseEventHandler(hadError) {
      console.log(`WdaMjpeg connection was closed${hadError ? ' by error' : ''}`)
      notifier.setDeviceAbsent('WdaMjpeg connection is lost')
      recoverDevice()
      lifecycle.fatal('WdaMjpeg connection is lost')
    }

    socket.on('connect', wdaMjpegConnectEventHandler)
    socket.on('close', wdaMjpegCloseEventHandler)
    connectToWdaMjpeg(options)

    return WdaClient
  })
