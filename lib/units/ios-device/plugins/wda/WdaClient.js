const request = require('request-promise')
const Promise = require('bluebird')
const baseUrl = 'http://192.168.0.124:8100'
const syrup = require('stf-syrup')
const logger = require('../../../../util/logger')
const asciiutil = require('../../../../util/asciiparser')
const port = 8100


module.exports = syrup.serial()
  .define((options) => {
    const log = logger.createLogger('WdaClient')

    const WdaClient = {
      sessionId: '',
      connect: (port) => {
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
      swipe: (params) => {
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
      tap: (params) => {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${baseUrl}/session/${WdaClient.sessionId}/wda/tap/0`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      homeBtn: () => {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${baseUrl}/wda/homescreen`
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      size: () => {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${baseUrl}/session/${WdaClient.sessionId}/window/size`
          })
            .then(response => {
              try {
                log.info('device size', response)
                return resolve(JSON.parse(response).value)
              } catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => reject(err))
        })
      },
      typeKey: (params) => {
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
      openUrl: (params) => {
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
      rotation: (params) => {
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
      screenshot: () => {
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

