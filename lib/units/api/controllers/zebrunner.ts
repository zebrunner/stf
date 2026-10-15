/**
* Fork (Zebrunner): the device routes the Zebrunner services use, see the paths with
* x-swagger-router-controller: zebrunner in lib/units/api/swagger/api_v1.yaml.
**/

import type {Response} from 'express'

import dbapi from '../../../db/api.js'
import logger from '../../../util/logger.js'
import type {ApiRequest} from '../../../types/units-api.js'

var log = logger.createLogger('api:controllers:zebrunner')

function getDeviceSize(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value

  dbapi.getDeviceSize(serial)
    .then(function(display) {
      if (!display) {
        return res.status(200).json({height: 0, width: 0, scale: 0})
      }
      return res.status(200).json(display)
    })
    .catch(function(err) {
      log.info('Failed to get device size: ', err.stack)
      return res.status(200).json({height: 0, width: 0, scale: 0})
    })
}

function getDeviceOwner(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value

  dbapi.getDeviceGroupOwner(serial)
    .then(function(owner) {
      if (!owner) {
        return res.status(404).json({
          success: false
        , description: 'Device not found'
        })
      }
      return res.status(200).json(owner)
    })
    .catch(function(err) {
      log.info('Failed to get device owner: ', err.stack)
      res.status(500).json({
        success: false
      })
    })
}

function getDeviceType(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value

  dbapi.getDeviceType(serial)
    .then(function(deviceType) {
      return res.status(200).json(deviceType)
    })
    .catch(function(err) {
      log.info('Failed to get device type: ', err.stack)
      return res.status(200).json({deviceType: null})
    })
}

export {
  getDeviceSize
, getDeviceOwner
, getDeviceType
}
