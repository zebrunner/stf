const request = require('request-promise')
const Promise = require('bluebird')
const ip = require('ip')
const ipAddr = ip.address()
const baseUrl = `http://192.168.0.102:8100`
// const baseUrl = `http://${ipAddr}:8100`
const syrup = require('stf-syrup')
const logger = require('../../../../util/logger')
const asciiutil = require('../../../../util/asciiparser')
const port = 8100


module.exports = syrup.serial()
  .define((options) => {
    const log = logger.createLogger('WdaClient')

    const WdaClient = {
      tochDownParams: {},
      isMove: false,
      sessionId: '',
      connect: function(port) {
        return new Promise((resolve, reject) => {
          request.get(baseUrl)
            .then(response => {
              try {
                WdaClient.sessionId = JSON.parse(response).sessionId
                return resolve()
              } catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => {
              log.error('connect err', err)
              return reject(err)
            })
        })
      },
      swipe: function(params) {
        this.isMove = true
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${baseUrl}/session/${WdaClient.sessionId}/wda/dragfromtoforduration`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      touchUp: function() {
        if(!this.isMove) {
          return new Promise((resolve, reject) => {
            request({
              method: 'POST',
              uri: `${baseUrl}/session/${WdaClient.sessionId}/wda/tap/0`,
              body: this.tochDownParams,
              json: true
            })
              .then(response => resolve(response))
              .catch(err => reject(err))
          })
        }
      },
      tap: function(params) {
        this.tochDownParams = params
        this.isMove = false
        // return new Promise((resolve, reject) => {
        //   request({
        //     method: 'POST',
        //     uri: `${baseUrl}/session/${WdaClient.sessionId}/wda/tap/0`,
        //     body: params,
        //     json: true
        //   })
        //     .then(response => resolve(response))
        //     .catch(err => reject(err))
        // })
      },
      homeBtn: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${baseUrl}/wda/homescreen`
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      size: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${baseUrl}/session/${WdaClient.sessionId}/window/size`
          })
            .then(response => {
              try {
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
            uri: `${baseUrl}/session/${WdaClient.sessionId}/wda/keys`,
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
            uri: `${baseUrl}/session/`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      rotation: function(params) {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${baseUrl}/session/${WdaClient.sessionId}/orientation`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      screenshot: function() {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${baseUrl}/screenshot`
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
      }
    }
    return WdaClient
  })
