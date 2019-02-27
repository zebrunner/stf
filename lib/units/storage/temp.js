var http = require('http')
var util = require('util')
var path = require('path')

var express = require('express')
var validator = require('express-validator')
var bodyParser = require('body-parser')
var formidable = require('formidable')
var Promise = require('bluebird')
var fs = require('fs')
var lifecycle = require('../../util/lifecycle')
var mkdir = Promise.promisify(require('fs').mkdir)
var rimraf = require('rimraf')
var uuid = require('uuid')
var srv = require('../../util/srv')
var wire = require('../../wire')
var wireutil = require('../../wire/util')
var zmqutil = require('../../util/zmqutil')
var decompress = require('decompress')
var spawn = require('child_process').spawn

var logger = require('../../util/logger')
var Storage = require('../../util/storage')
var requtil = require('../../util/requtil')
var download = require('../../util/download')

module.exports = function(options) {
  var log = logger.createLogger('storage:temp')
  var app = express()
  var server = http.createServer(app)
  var storage = new Storage()
  var solo = wireutil.makePrivateChannel()

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.use(bodyParser.json())
  app.use(validator())
  var push = zmqutil.socket('push')
  Promise.map(options.endpoints.push, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('ios temp storage sending output to "%s"', record.url)
        push.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })
    .then(() => {
      log.info(
        `Storage temp successfully connected to zmqutil sockets on port ${
          options.endpoints.push
        }`
      )
    })
    .catch(function(err) {
      log.fata('Unable to connect temp to push endpoints', err)
    })

  var sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  }).catch(function(err) {
    log.fatal('Unable to connect to sub endpoint', err)
    lifecycle.fatal()
  })
  ;[solo].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  storage.on('timeout', function(id) {
    log.info('Cleaning up inactive resource "%s"', id)
  })

  function clearTmpDir(path) {
    rimraf(path, function() {
      return
    })
  }

  app.post('/s/download/:plugin', function(req, res) {
    requtil
      .validate(req, function() {
        req.checkBody('url').notEmpty()
      })
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
      .then(function(file) {
        var plugin = req.params.plugin
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
      .catch(requtil.ValidationError, function(err) {
        res.status(400).json({
          success: false,
          error: 'ValidationError',
          validationErrors: err.errors
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
  app.post('/s/upload/:plugin', function(req, res) {
    var form = new formidable.IncomingForm({
      maxFileSize: options.maxFileSize
    })
    if (options.saveDir) {
      form.uploadDir = options.saveDir
    }
    log.info('s/upload route,form:', form)
    Promise.promisify(form.parse, form)(req)
      .spread(function(fields, files) {
        return Object.keys(files).map(function(field) {
          var file = files[field]
          return {
            field: field,
            id: storage.store(file),
            name: file.name
          }
        })
      })
      .then(function(storedFiles) {
        res.status(201).json({
          success: true,
          resources: (function() {
            var mapped = Object.create(null)
            storedFiles.forEach(function(file) {
              var plugin = req.params.plugin
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
      .catch(function(err) {
        log.error('Error storing resource', err.stack)
        res.status(500).json({
          success: false,
          error: 'ServerError'
        })
      })
  })

  app.post('/s/uploadIos/:plugin/:deviceId/:bundleId', function(req, res) {
    var tmpDirId = uuid.v4()
    var deviceId = req.params.deviceId
    var bundleId = req.params.bundleId
    var tmpDirPath = path.join(__dirname, `tmp/${tmpDirId}`)
    if (deviceId && deviceId.length > 0 && bundleId !== '') {
      mkdir(tmpDirPath)
        .then(tmpDir => {
          var form = new formidable.IncomingForm({
            uploadDir: tmpDirPath,
            keepExtensions: true
          })
          form.parse(req, function(err, field, files) {
            if (!err) {
              Object.keys(files).map(function(value, key) {
                var file = files[value]
                decompress(file.path, tmpDirPath)
                  .then(function(file) {
                    clearTmpDir(tmpDirPath)
                  })
                  .catch(function(err) {
                    if (/\.zip$/.test(file.name)) {
                      res.status(201)
                      var appName = file.name.slice(0, -4)
                      var args = [
                        '--id',
                        deviceId,
                        '--bundle',
                        appName
                      ]
                      var iosDeploy = spawn('ios-deploy', args, {
                        cwd: tmpDirPath,
                        shell: true
                      })

                      push.send([
                        wireutil.global,
                        wireutil.envelope(
                          new wire.SetDeviceApp(
                            deviceId,
                            bundleId,
                            file.name.slice(0, -4),
                            tmpDirPath
                          )
                        )
                      ])

                      iosDeploy.stdout.on('data', function(data) {
                        // @TODO add handler
                        log.info('iosDeploy.stdout data :', data.toString())
                        // var output = data.toString()
                      })

                      iosDeploy.stderr.on('data', function(data) { 
                        log.info('iosDeploy.stderr data :', data.toString())
                      })

                      iosDeploy.on('close', function(code) {
                        res.json({ package: appName })
                        push.send([
                          wireutil.global,
                          wireutil.envelope(new wire.DeviceOnInstAppMessage(
                            deviceId
                          ))
                        ])
                        if (code) {
                          log.important(
                            `iosDeployClosed with code: ${code.toString()}`
                          )
                        }
                      })
                    } else {
                      clearTmpDir(tmpDirPath)
                      res.status(404).send('Error')
                    }
                  })
              })
            } else {
              clearTmpDir(tmpDirPath)
              res.status(404).send('Error')
            }
            log.info('s/upload/ field, files:', files)
          })
        })
        .catch(err => {
          clearTmpDir(tmpDirPath)
        })
    } else {
      res.status(404)
      res.end()
    }
  })

  app.get('/s/blob/:id/:name', function(req, res) {
    var file = storage.retrieve(req.params.id)
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
    } else {
      res.sendStatus(404)
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
