/**
* Fork (Zebrunner): the device routes the Zebrunner services use, see the paths with
* x-swagger-router-controller: zebrunner in lib/units/api/swagger/api_v1.yaml.
**/

import type {Response} from 'express'
import * as uuid from 'uuid'

import dbapi from '../../../db/api.js'
import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import wirerouter from '../../../wire/router.js'
import type {MessageListener, ApiRequest} from '../../../types/units-api.js'

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
      if (deviceType === null) {
        return res.status(404).json({success: false, description: 'Device not found'})
      }
      if (!deviceType) {
        return res.status(404).json({success: false, description: 'Device type unknown'})
      }
      return res.status(200).json({type: deviceType})
    })
    .catch(function(err) {
      log.info('Failed to get device type: ', err.stack)
      res.status(500).json({success: false})
    })
}

// the device answers the keepalive at once, as any message of its group
export var KEEPALIVE_TIMEOUT_MS = 5000

// POST /user/devices/{serial}/keepalive: the reservation of a device the user uses lasts its timeout
// from now. The timeout of a reservation counts the time without a message for the device, and a
// session of the grid (Appium) sends none: mcloud-grid keeps the devices of its sessions with it.
// The device gets the GroupMessage of its group again, which changes nothing but its last activity;
// 403 when the device is not the one of the user (any more), 504 when it does not answer
function keepUserDeviceBySerial(req: ApiRequest, res: Response) {
  var serial = req.swagger.params.serial.value

  return dbapi.loadDeviceBySerial(serial)
    .then(function(device) {
      if (!device) {
        return res.status(404).json({success: false, description: 'Device not found'})
      }
      var owner = device.owner
      if (!device.present || !owner || owner.email !== req.user.email) {
        return res.status(403).json({success: false, description: 'Device is not used by you'})
      }

      var responseChannel = 'txn_' + uuid.v4()
      var messageListener: MessageListener, timer: ReturnType<typeof setTimeout>
      function answer(code: number, body: object) {
        clearTimeout(timer)
        req.options.sub.unsubscribe(responseChannel)
        req.options.channelRouter.removeListener(responseChannel, messageListener)
        res.status(code).json(body)
      }

      req.options.sub.subscribe(responseChannel)
      timer = setTimeout(function() {
        answer(504, {success: false, description: 'Device is not responding'})
      }, KEEPALIVE_TIMEOUT_MS)
      messageListener = wirerouter()
        .on(wire.TransactionDoneMessage, function(channel, message) {
          if (message.success) {
            answer(200, {success: true, description: 'The reservation of the device is kept'})
          }
          else {
            // the device is in another group: the reservation of the user ended meanwhile
            answer(403, {success: false, description: 'Device is not used by you'})
          }
        })
        .handler()
      req.options.channelRouter.on(responseChannel, messageListener)

      req.options.push.send([
        device.channel
      , wireutil.transaction(
          responseChannel
        , new wire.GroupMessage(
            new wire.OwnerMessage(owner.email, owner.name, owner.group)
          , null
          , wireutil.toDeviceRequirements({
              serial: {
                value: serial
              , match: 'exact'
              }
            })
          , device.usage || null
          )
        )
      ])
      return null
    })
    .catch(function(err) {
      log.error('Failed to keep the reservation of device "%s": ', serial, err.stack)
      res.status(500).json({success: false})
    })
}

export {
  getDeviceSize
, getDeviceOwner
, getDeviceType
, keepUserDeviceBySerial
}
