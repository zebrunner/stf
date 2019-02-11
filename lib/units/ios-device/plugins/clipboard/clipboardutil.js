const syrup = require('stf-syrup')

const {EventEmitter} = require('events')
const Promise = require('bluebird')
const path = require('path')
const logger = require('../../../../util/logger')
const {spawn} = require('child_process')
const REG_EXPRESSION_FOR_APP = /istf.clipboard-utilit/
const REG_EXPRESSION_FOR_PASTEBOARD = /pasteBoard=([\w_\-*&.,\'"~@$%^&*!?() |\\/:{}()#]+)/
let checkExistsClipboardUtil, iosDeploy

function killChildProcesses() {
  iosDeploy.kill()
  checkExistsClipboardUtil.kill()
}

module.exports = syrup.serial()
  .define(function(options) {
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

    let getClipBoard = () => {
      return new Promise((resolve, reject) => {
        function getPasteBoard(deployApp = false) {
          if(!deployApp) {
            iosDeployArgs.push('--noinstall')
          }

          iosDeploy = spawn('ios-deploy', iosDeployArgs)

          iosDeploy.stdout.on('data', data => {
            let searchResult = data.toString().match(REG_EXPRESSION_FOR_PASTEBOARD)
            if(searchResult) {
              killChildProcesses()
              return resolve(searchResult.input)
            }
          })

          iosDeploy.on('close', err => {
            killChildProcesses()
            return reject(err)
          })
        }

        pasteBoard.on('getPasteBoard', getPasteBoard)

        checkExistsClipboardUtil = spawn('ios-deploy', ['--list_bundle_id'])

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
