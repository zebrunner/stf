const request = require('request-promise')
const Promise = require('bluebird')
const iputil = require('../util/iputil')
const syrup = require('stf-syrup')
const logger = require('../../../../util/logger')


module.exports = syrup.serial()
  .define((options) => {
    const log = logger.createLogger('WdaClient')
    const ip = iputil(options.serial)

    const WdaClient = {
      touchDownParams: {},
      isMove: false,
      deviceSize: {},
      baseUrl: '',
      sessionId: '',
      scalarMax: 1,
      orientation: 'PORTRAIT',
      connect: function(port) {
        this.baseUrl = `http://${ip}:${ port || options.wdaServerPort}`
        return new Promise((resolve, reject) => {
          request.get(this.baseUrl)
            .then(response => {
              try {
                this.sessionId = JSON.parse(response).sessionId
                return resolve()
              } catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => {
              return reject(err)
            })
        })
      },
      swipe: function(params) {
        const scale = this.setSwipeScaleByRotation(params)
        this.isMove = true
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/dragfromtoforduration`,
            body: scale,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      touchUp: function() {
        if(!this.isMove) {
          this.setTouchUpScaleByRotation()
          return new Promise((resolve, reject) => {
            request({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/tap/0`,
              body: this.touchDownParams,
              json: true
            })
              .then(response => resolve(response))
              .catch(err => reject(err))
          })
        }
      },
      tap: function(params) {
        this.touchDownParams = params
        this.isMove = false
      },
      homeBtn: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/wda/homescreen`
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      size: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${this.baseUrl}/session/${this.sessionId}/window/size`
          })
            .then(response => {
              try {
                this.deviceSize = JSON.parse(response).value
                return resolve(JSON.parse(response).value)
              } catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => reject(err))
        })
      },
      typeKey: function(params) {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/keys`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      openUrl: function(params) {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      rotation: function(params) {
        this.orientation = params.orientation
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
            body: params,
            json: true
          })
            .then(response => {
              this.setDeviceSizeByOrientation()
              return resolve(response)
            })
            .catch(err => reject(err))
        })
      },
      screenshot: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${this.baseUrl}/screenshot`
          })
            .then(response => {
              try {
                resolve(JSON.parse(response))
              } catch(e) {
                reject(e)
              }
            })
            .catch(err => reject(err))
        })
      },
      setSwipeScaleByRotation: function(params) {
        const { deviceSize } = this
        switch(this.orientation) {
          case 'PORTRAIT':
            return {
              fromX: params.fromX * deviceSize.width,
              fromY: params.fromY * deviceSize.height,
              toX: params.toX * deviceSize.width,
              toY: params.toY * deviceSize.height,
              duration: params.duration
            }
          case 'LANDSCAPE':
            return {
              toX: params.fromY * deviceSize.height,
              toY: params.fromX * deviceSize.width,
              fromX: params.toY * deviceSize.height,
              fromY: params.toX * deviceSize.width,
              duration: params.duration
            }
          default:
            return {
              fromX: params.fromX * deviceSize.width,
              fromY: params.fromY * deviceSize.height,
              toX: params.toX * deviceSize.width,
              toY: params.toY * deviceSize.height,
              duration: params.duration
            }
        }
      },
      setTouchUpScaleByRotation: function() {
        let { touchDownParams, deviceSize } = this
        switch(this.orientation) {
          case 'PORTRAIT':
            return this.touchDownParams = {
              x: touchDownParams.x * deviceSize.width,
              y: touchDownParams.y * deviceSize.height
            }
          case 'LANDSCAPE':
            return this.touchDownParams = {
              y: Math.abs(touchDownParams.x - this.scalarMax) * deviceSize.width,
              x: touchDownParams.y * deviceSize.height
            }
          default:
            return this.touchDownParams = {
              x: touchDownParams.x * deviceSize.width,
              y: touchDownParams.y * deviceSize.height
            }
        }
      },
      getPasteboard: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/getPasteboard`,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      // setDeviceSizeByOrientation: function() {
      //   this.deviceSize = {
      //     width: this.deviceSize.height,
      //     height: this.deviceSize.width
      //   }
      // }
    }
    return WdaClient
  })
