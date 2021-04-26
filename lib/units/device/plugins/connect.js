/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var util = require('util')

var syrup = require('@devicefarmer/stf-syrup')
var Promise = require('bluebird')

var logger = require('../../../util/logger')
var grouputil = require('../../../util/grouputil')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var lifecycle = require('../../../util/lifecycle')

module.exports = syrup.serial()
  .dependency(require('../support/adb'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('./group'))
  .dependency(require('./solo'))
  .dependency(require('./util/urlformat'))
  .define(function(options, adb, router, push, group, solo, urlformat) {
    var log = logger.createLogger('device:plugins:connect')
    log.info("111");
    var plugin = Object.create(null)
    var activeServer = null

    plugin.port = options.connectPort
    plugin.url = urlformat(options.connectUrlPattern, plugin.port)
    log.info("222");
    plugin.start = function() {
      return new Promise(function(resolve, reject) {
        log.info("333");
        if (plugin.isRunning()) {
          log.info("444");
          return resolve(plugin.url)
        }
        log.info("555");
        var server = adb.createTcpUsbBridge(options.serial, {
          auth: function(key) {
            var resolver = Promise.defer()

            function notify() {
              log.info("666");
              group.get()
                .then(function(currentGroup) {
                  push.send([
                    solo.channel
                  , wireutil.envelope(new wire.JoinGroupByAdbFingerprintMessage(
                      options.serial
                    , key.fingerprint
                    , key.comment
                    , currentGroup.group
                    ))
                  ])
                })
                .catch(grouputil.NoGroupError, function() {
                  push.send([
                    solo.channel
                  , wireutil.envelope(new wire.JoinGroupByAdbFingerprintMessage(
                      options.serial
                    , key.fingerprint
                    , key.comment
                    ))
                  ])
                })
            }

            function joinListener(group, identifier) {
              log.info("777");
              if (identifier !== key.fingerprint) {
                resolver.reject(new Error('Somebody else took the device'))
              }
            }

            function autojoinListener(identifier, joined) {
              log.info("888");
              if (identifier === key.fingerprint) {
                if (joined) {
                  resolver.resolve()
                }
                else {
                  resolver.reject(new Error('Device is already in use'))
                }
              }
            }

            log.info("999");
            group.on('join', joinListener)
            group.on('autojoin', autojoinListener)
            router.on(wire.AdbKeysUpdatedMessage, notify)

            notify()
            log.info("aaa");
            return resolver.promise
              .timeout(120000)
              .finally(function() {
                log.info("bbb");
                group.removeListener('join', joinListener)
                group.removeListener('autojoin', autojoinListener)
                router.removeListener(wire.AdbKeysUpdatedMessage, notify)
              })
          }
        })

        server.on('listening', function() {
          log.info("ccc");
          resolve(plugin.url)
        })

        server.on('connection', function(conn) {
          log.info("ddd");
          log.info('New remote ADB connection from %s', conn.remoteAddress)
          conn.on('userActivity', function() {
            group.keepalive()
          })
        })

        log.info("eee");
        server.on('error', reject)

        log.info("fff");
        log.info(util.format('Listening on port %d', plugin.port))
        server.listen(plugin.port)

        log.info("ggg");
        activeServer = server
        lifecycle.share('Remote ADB', activeServer)
        log.info("hhh");
      })
    }

    plugin.stop = Promise.method(function() {
      log.info("iii");
      if (plugin.isRunning()) {
        log.info("jjj");
        activeServer.close()
        activeServer.end()
        activeServer = null
      }
    })

    plugin.end = Promise.method(function() {
      log.info("kkk");
      if (plugin.isRunning()) {
        log.info("lll");
        activeServer.end()
      }
    })

    plugin.isRunning = function() {
      log.info("mmm");
      return !!activeServer
    }

    log.info("nnn");
    lifecycle.observe(plugin.stop)
    group.on('leave', plugin.stop)
    log.info("ooo");

    router
      .on(wire.ConnectStartMessage, function(channel) {
        var reply = wireutil.reply(options.serial)
        plugin.start()
          .then(function(url) {
            push.send([
              channel
            , reply.okay(url)
            ])

            // Update DB
            push.send([
              channel
            , wireutil.envelope(new wire.ConnectStartedMessage(
                options.serial
              , url
              ))
            ])
            log.important('Remote Connect Started for device "%s" at "%s"', options.serial, url)
          })
          .catch(function(err) {
            log.error('Unable to start remote connect service', err.stack)
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })
      .on(wire.ConnectStopMessage, function(channel) {
        var reply = wireutil.reply(options.serial)
        plugin.stop()
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
            // Update DB
            push.send([
              channel
            , wireutil.envelope(new wire.ConnectStoppedMessage(
                options.serial
              ))
            ])
            log.important('Remote Connect Stopped for device "%s"', options.serial)
          })
          .catch(function(err) {
            log.error('Failed to stop connect service', err.stack)
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })

    log.info("ppp");
    return(plugin)
  })
