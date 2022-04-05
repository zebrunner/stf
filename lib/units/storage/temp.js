const http = require('http')
const util = require('util')
const path = require('path')
const express = require('express')
const validator = require('express-validator')
const bodyParser = require('body-parser')
const formidable = require('formidable')
const Promise = require('bluebird')
const lifecycle = require('../../util/lifecycle')
const mkdir = Promise.promisify(require('fs').mkdir)
const rimraf = require('rimraf')
const uuid = require('uuid')
const srv = require('../../util/srv')
const wire = require('../../wire')
const wireutil = require('../../wire/util')
const zmqutil = require('../../util/zmqutil')
const decompress = require('decompress')
const {spawn} = require('child_process')
const REG_EXPRESSION_ZIP_FILE = /\.zip$/
const logger = require('../../util/logger')
const Storage = require('../../util/storage')
const requtil = require('../../util/requtil')
const download = require('../../util/download')
const bundletool = require('../../util/bundletool')
var crypto = require('crypto')

module.exports = options => {
  const log = logger.createLogger('storage:temp')
  const app = express()
  const server = http.createServer(app)
  const storage = new Storage()
  const solo = wireutil.makePrivateChannel()

  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  app.set('trust proxy', true)

  app.use(bodyParser.json())
  app.use(validator())
  let push = zmqutil.socket('push')
  Promise.map(options.endpoints.push, endpoint => {
     srv.resolve(endpoint).then(records => {
       srv.attempt(records, record => {
        log.info('temp storage sending output to "%s"', record.url)
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
    .catch(err => log.fatal('Unable to connect temp to push endpoints', err))

  let sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, endpoint => {
    srv.resolve(endpoint).then(records => {
      srv.attempt(records, record => {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  }).catch(err => {
    log.fatal('Unable to connect to sub endpoint', err)
    lifecycle.fatal()
  })
  ;[solo].forEach(channel => {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  storage.on('timeout', id => log.info('Cleaning up inactive resource "%s"', id))

  function clearTmpDir(path) {
    log.info('clearTmpDir "%s"', path)
    rimraf(path, function() {
      return
    })
  }

  app.post('/s/download/:plugin', (req, res) => {
    requtil
      .validate(req, () => req.checkBody('url').notEmpty())
      .then(() => download(req.body.url, {dir: options.cacheDir}))
      .then(file => {
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

  app.post('/s/uploadIos/:plugin/:deviceId', (req, res) => {
    let tmpDirId = uuid.v4()
    let {deviceId} = req.params

    let tmpDirPath = path.join(options.saveDir, `/${tmpDirId}`)
    if (deviceId && deviceId.length > 0) {
      log.info('mkdir "%s"', tmpDirPath)
      mkdir(tmpDirPath)
        .then(() => {
          let form = new formidable.IncomingForm({
            uploadDir: tmpDirPath,
            keepExtensions: true
          })
          form.parse(req, (err, field, files) => {
            if (!err) {
              Object.keys(files).map((value) => {
                let file = files[value]
                log.info('installing "%s:%s"', file.name, file.path)
                
                res.status(201)
                let args = [
                  '--path=' + file.path,
                  '--udid=' + deviceId,
                ]
                log.info('args "%s"', args)
                let iosInstall = spawn('ios install', args, {
                  cwd: tmpDirPath,
                  shell: true
                })
/*
                push.send([
                  wireutil.global,
                  wireutil.envelope(
                    new wire.SetDeviceApp(
                      deviceId,
                      file.name.slice(0, -4),
                      tmpDirPath
                    )
                  )
                ])
*/
                
                iosInstall.stdout.on('data', data => {
                  // @TODO add handler
                  log.info('iosInstall.stdout data :', data.toString())
                  // var output = data.toString()
                })

                iosInstall.stderr.on('data', data => {
                  log.info('iosInstall.stderr data :', data.toString())
                })
                let appName = file.name.slice(0, -4)
                iosInstall.on('close', code => {
                  res.json({package: appName})
                  push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.DeviceOnInstAppMessage(
                      deviceId
                    ))
                  ])
                  if (code) {
                    log.important(`iosInstallClosed with code: ${code.toString()}`)
                  }
                })
              })
            }
            else {
              clearTmpDir(tmpDirPath)
              res.status(404).send('Error')
            }
          })
        }).catch(err => log.fatal('Unable to create temp dir', err))
    }
    else {
      res.status(404)
      res.end()
    }
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
