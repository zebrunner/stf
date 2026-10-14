import events from 'events'

import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../../util/logger.js'
import dbapi from '../../../../db/api.js'
import type {
  DisplayProperties
, IosDeviceOptions
, IosDisplay
, IosScreenOptions
} from '../../../../types/ios-device.js'
import screenOptionsSyrup from '../screen/options.js'

class Display extends events.EventEmitter implements IosDisplay {
  id: number
  properties: DisplayProperties

  constructor(id: number, properties: DisplayProperties) {
    super()
    this.id = id
    this.properties = properties
  }

  updateRotation(newRotation: number): void {
    this.properties.rotation = newRotation
    this.emit('rotationChange', newRotation)
  }
}

export default syrup.serial()
  .dependency(screenOptionsSyrup)
  .define(function(options: IosDeviceOptions, screenOptions: IosScreenOptions) {
    var log = logger.createLogger('device:plugins:display')

    log.info('Reading display info')
    return dbapi.getDeviceSize(options.serial).then(function(display) {
      var properties: DisplayProperties = {
        id: 0
      , width: typeof display?.width === 'number' ? display.width : 0
      , height: typeof display?.height === 'number' ? display.height : 0
      , xdpi: 0
      , ydpi: 0
      , fps: 60
      , density: 1
      , rotation: typeof display?.rotation === 'number' ? display.rotation : 0
      , secure: true
      , size: 0
      , url: screenOptions.publicUrl
      }
      return new Display(0, properties)
    })
  })
