import path from 'path'

import {Router as createRouter} from 'express'
import type {NextFunction, Request, Response} from 'express'
import deviceData from '@devicefarmer/stf-device-db'

import pathutil from '../../../util/pathutil.js'

// Fork (Zebrunner): the icons of the platforms, which the device list shows for every device
var platformIcons: Record<string, string> = {
  Android: 'Android.jpg'
, iOS: 'iOS.jpg'
, tvOS: 'tvOS.png'
}

// The UI falls back to this icon when a device has neither a platform nor an image
var defaultImage = '_default'

function imageStem(image: string): string {
  return image.replace(/\.(?:svg|jpe?g|png|webp)$/i, '')
}

function isSize(type: string, size: string): boolean {
  return type === 'icon' ? size === 'x24' || size === 'x120' : type === 'photo' && size === 'x800'
}

export default function() {
  var router = createRouter()

  router.get('/:type/:size/:image', function(req: Request, res: Response, next: NextFunction) {
    var type = req.params.type as string
    var size = req.params.size as string
    var image = req.params.image as string
    if (!isSize(type, size)) {
      next()
      return
    }

    var stem = imageStem(image)
    if (type === 'icon' && Object.prototype.hasOwnProperty.call(platformIcons, stem)) {
      res.sendFile(path.join(pathutil.root('icon'), size, platformIcons[stem]!), {maxAge: '30d'})
      return
    }

    // stf-device-db 2 draws the devices it knows rather than shipping their pictures
    var generic = stem === defaultImage
    if (!generic && !deviceData.find({model: stem, name: stem})) {
      next()
      return
    }

    var svg = deviceData.generateDeviceSvg(generic ? {size: size} : {size: size, image: image})
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=2592000')
    // The SVG may be opened directly: no scripts, nothing loaded from elsewhere
    res.setHeader('Content-Security-Policy', 'default-src \'none\'; style-src \'unsafe-inline\'')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(svg)
  })

  return router
}
