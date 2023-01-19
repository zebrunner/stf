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
      touchDownParams: {},
      isMove: false,
      tapStartAt: 0,
      typeKeyActions: [],
      typeKeyTimerId: null,
      typeKeyDelay: 250,

      startSession: function() {
        log.info('verifying wda session status...')

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

              return this.size()
            }

            log.info('starting wda session...')
            const params = {
              capabilities: {},
            }

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
                this.batteryIosEvent()

                return this.size()
              })
              .catch((err) => {
                log.error('"startSession" No valid response from web driver!', err)
                return Promise.reject(err)
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

          return this.handleRequest(requestParams)
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
        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/wda/homescreen`
        })
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
                {type: 'pointerMove', duration: scale.duration * 200, x: scale.toX, y: scale.toY},
                {type: 'pointerUp'},
              ],
            },
          ],
        }

        this.isMove = true

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

            return this.handleRequest({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
              body,
              json: true,
            })
          }
          else {
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
      rotation: function(params) {
        this.orientation = params.orientation

        return this.handleRequest({
          method: 'POST',
          uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
          body: params,
          json: true
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
