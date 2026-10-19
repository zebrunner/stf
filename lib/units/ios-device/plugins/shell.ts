import syrup from '@devicefarmer/stf-syrup'

import logger from '../../../util/logger.js'
import wire from '../../../wire/index.js'
import wireutil from '../../../wire/util.js'
import type {ShellKeepAliveMessage} from '../../../types/wire.js'
import type {IosDeviceOptions, Push, Router, Sub} from '../../../types/ios-device.js'
import pushSyrup from '../support/push.js'
import routerSyrup from '../support/router.js'
import subSyrup from '../support/sub.js'
import {GoIosCommandError, shellArgs, spawnGoIos} from './util/goios.js'

// The shell of the device dashboard: the go-ios commands of the allow list of util/goios.ts on the
// device of the unit, their output (stdout and the logs of go-ios) is sent as it comes
export default syrup.serial()
  .dependency(routerSyrup)
  .dependency(pushSyrup)
  .dependency(subSyrup)
  .define(function(options: IosDeviceOptions, router: Router, push: Push, sub: Sub) {
    var log = logger.createLogger('device:plugins:shell')

    router.on(wire.ShellCommandMessage, function(channel, message) {
      var reply = wireutil.reply(options.serial)
      var args: string[] = []

      try {
        args = shellArgs(message.command)
      }
      catch (err) {
        var reason = err instanceof GoIosCommandError ? err.message : String(err)
        log.warn('Refused shell command "%s": %s', message.command, reason)
        push.send([channel, reply.fail(reason)])
        return
      }

      log.info('Running go-ios command "%s"', args.join(' '))

      var child = spawnGoIos(options.serial, args)
      var timer: ReturnType<typeof setTimeout> | undefined
      var finished = false

      function forceStop() {
        child.kill()
      }

      function keepAliveListener(_channel: string | Buffer, keepAlive: ShellKeepAliveMessage) {
        clearTimeout(timer)
        timer = setTimeout(forceStop, keepAlive.timeout)
      }

      function output(chunk: Buffer) {
        push.send([channel, reply.progress(chunk.toString())])
      }

      function finish(err?: Error) {
        if (finished) {
          return
        }
        finished = true
        clearTimeout(timer)
        sub.unsubscribe(channel as string)
        router.removeListener(wire.ShellKeepAliveMessage, keepAliveListener)
        if (err) {
          log.error('go-ios command "%s" failed', args.join(' '), err.stack)
          push.send([
            channel
          , reply.fail((err as NodeJS.ErrnoException).code === 'ENOENT' ?
              'go-ios is not installed' :
              err.message)
          ])
        }
        else {
          push.send([channel, reply.okay(null)])
        }
      }

      child.stdout.on('data', output)
      child.stderr.on('data', output)
      child.on('error', finish)
      child.on('close', function() {
        finish()
      })

      sub.subscribe(channel as string)
      router.on(wire.ShellKeepAliveMessage, keepAliveListener)
      timer = setTimeout(forceStop, message.timeout)
    })
  })
