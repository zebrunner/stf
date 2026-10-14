/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var http = require('http')
var util = require('util')
var path = require('path')
var crypto = require('crypto')

var express = require('express')
var bodyParser = require('body-parser')
var formidable = require('formidable')
var Promise = require('bluebird')

var logger = require('../../util/logger')
var Storage = require('../../util/storage')
var requtil = require('../../util/requtil')
var download = require('../../util/download')
var bundletool = require('../../util/bundletool')

module.exports = function(options) {
  var log = logger.createLogger('storage:temp')
  var app = express()
  var server = http.createServer(app)
  var storage = new Storage()

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.use(bodyParser.json())

  app.disable('x-powered-by')

  storage.on('timeout', function(id) {
    log.info('Cleaning up inactive resource "%s"', id)
  })

  app.post('/s/download/:plugin', requtil.validators.tempUrlValidator, function(req, res) {
    requtil.validate(req)
      .then(function() {
        return download(req.body.url, {
          dir: options.cacheDir
        })
      })
      .then(function(file) {
        return {
          id: storage.store(file),
          name: file.name
        }
      })
      .then(file => {
        let {plugin} = req.params
        res.status(201).json({
          success: true,
          resource: {
            date: new Date(),
            plugin: plugin,
            id: file.id,
            name: file.name,
            href: util.format(
              '/s/%s/%s%s',
              plugin,
              file.id,
              file.name ? util.format('/%s', path.basename(file.name)) : ''
            )
          }
        })
      })
      .catch(requtil.ValidationError, err => {
        res.status(400).json({
          success: false,
          error: 'ValidationError',
          validationErrors: err.errors
        })
      })
      .catch(err => {
        log.error('Error storing resource', err.stack)
        res.status(500).json({
          success: false,
          error: 'ServerError'
        })
      })
  })
  app.post('/s/upload/:plugin', (req, res) => {
    let form = new formidable.IncomingForm({
      maxFileSize: options.maxFileSize
    })
    if (options.saveDir) {
      form.uploadDir = options.saveDir
    }
    form.on('fileBegin', function(name, file) {
      if (/\.aab$/.test(file.name)) {
        file.isAab = true
      }
      var md5 = crypto.createHash('md5')
      file.name = md5.update(file.name).digest('hex')
    })
    log.info('s/upload route,form:', form)
    Promise.promisify(form.parse, form)(req)
      .spread((fields, files) => Object.keys(files).map(field => {
          let file = files[field]
          return {
            field: field
          , id: storage.store(file)
          , name: file.name
          , path: file.path
          , isAab: file.isAab
          }
        })
      )
      .then(storedFiles => {
        res.status(201).json({
          success: true,
          resources: (() => {
            let mapped = Object.create(null)
            storedFiles.forEach(file => {
              let {plugin} = req.params
              log.info(
                'stored file href :',
                util.format(
                  '/s/%s/%s%s',
                  plugin,
                  file.id,
                  file.name ? util.format('/%s', path.basename(file.name)) : ''
                )
              )
              mapped[file.field] = {
                date: new Date(),
                plugin: plugin,
                id: file.id,
                name: file.name,
                href: util.format(
                  '/s/%s/%s%s',
                  plugin,
                  file.id,
                  file.name ? util.format('/%s', path.basename(file.name)) : ''
                )
              }
            })
            log.info(mapped)
            return mapped
          })()
        })
      })
      .then(function(storedFiles) {
        return Promise.all(storedFiles.map(function(file) {
            return bundletool({
              bundletoolPath: options.bundletoolPath
            , keystore: options.keystore
            , file: file
            })
          })
        )
      })
      .then(function(storedFiles) {
        res.status(201)
          .json({
            success: true
          , resources: (function() {
              var mapped = Object.create(null)
              storedFiles.forEach(function(file) {
                var plugin = req.params.plugin
                mapped[file.field] = {
                  date: new Date()
                , plugin: plugin
                , id: file.id
                , name: file.name
                , href: util.format(
                    '/s/%s/%s%s'
                  , plugin
                  , file.id
                  , file.name ?
                      util.format('/%s', path.basename(file.name)) :
                      ''
                  )
                }
              })
              return mapped
            })()
          })
      })
      .catch(function(err) {
        log.error('Error storing resource', err.stack)
        res.status(500).json({
          success: false,
          error: 'ServerError'
        })
      })
  })

  app.get('/s/blob/:id/:name', (req, res) => {
    let file = storage.retrieve(req.params.id)
    if (file) {
      if (typeof req.query.download !== 'undefined') {
        res.set(
          'Content-Disposition',
          'attachment; filename="' + path.basename(file.name) + '"'
        )
      }
      res.set('Content-Type', file.type)
      log.info(file.path)
      res.sendFile(file.path)
    }
    else {
      res.sendStatus(404)
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
