const syrup = require('@devicefarmer/stf-syrup')

const {EventEmitter} = require('events')
const Promise = require('bluebird')
const path = require('path')
const logger = require('../../../../util/logger')
const {spawn} = require('child_process')
const REG_EXPRESSION_FOR_APP = /istf.clipboard-utilit/
const REG_EXPRESSION_FOR_PASTEBOARD = /pasteBoard=(.*)/
const REG_EXPRESSION_PASTEBOARD_NILL = /^pasteBoard=nill$/
const REG_EXPRESSION_SUBSTR_OPTIONAL = 'Optional\\((.*)\\)'
let checkExistsClipboardUtil, iosDeploy

const killChildProcesses = () => {
  iosDeploy.kill('SIGTERM')
  checkExistsClipboardUtil.kill('SIGTERM')
}

const clipboardFilter = (text) => {
  let re = new RegExp(REG_EXPRESSION_SUBSTR_OPTIONAL)
  if(REG_EXPRESSION_PASTEBOARD_NILL.test(text)) {
    return 'Pasteboard is empty'
  }
  else if(text.includes('Optional')) {
    let result = text.match(re)
    if(result) {
      return result[1]
    } else {
      return ''
    }
  }
}

module.exports = syrup.serial()
  .define((options) => {
    const log = logger.createLogger('ios-device:clipboardutil')
    class PasteBoard extends EventEmitter {}
    const pasteBoard = new PasteBoard()
    let iosDeployArgs = [
      '--id',
      options.serial,
      '--verbose',
      '--debug',
      '--bundle',
      path.join(__dirname, 'clickboard_utilit.app')
    ]
    const spawnOptions = {
      detached: false
    }

    let getClipBoard = () => {
      return new Promise((resolve, reject) => {
        const getPasteBoard = (deployApp = false) => {
          if(!deployApp) {
            iosDeployArgs.push('--noinstall')
          }

          iosDeploy = spawn('ios-deploy2', iosDeployArgs, spawnOptions)

          iosDeploy.stdout.on('data', data => {
            log.important(data.toString())
            let searchResult = data.toString().match(REG_EXPRESSION_FOR_PASTEBOARD)
            if(searchResult) {
              killChildProcesses()
              return resolve(clipboardFilter(searchResult.input))
            }
          })

          iosDeploy.on('close', err => {
            killChildProcesses()
            return reject(err)
          })
        }

        pasteBoard.once('getPasteBoard', getPasteBoard)

        checkExistsClipboardUtil = spawn('ios-deploy3', ['--list_bundle_id'], spawnOptions)

        checkExistsClipboardUtil.stdout.on('data', data => {
          if(REG_EXPRESSION_FOR_APP.test(data.toString())) {
            pasteBoard.emit('getPasteBoard')
          }
        })

        checkExistsClipboardUtil.stderr.on('data', data => {
          if(REG_EXPRESSION_FOR_APP.test(data.toString())) {
            pasteBoard.emit('getPasteBoard')
          }
        })

        checkExistsClipboardUtil.on('close', err => {
          pasteBoard.emit('getPasteBoard', true)
          pasteBoard.removeListener('getPasteBoard', getPasteBoard)
        })
      })
    }

    return {
      getClipBoard
    }
  })
