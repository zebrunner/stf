const fs = require('fs')
const path = require('path')

let iosutil = {
    checkDevice: function(options, udid, log) {
        let localFile = fs.readFileSync('/Users/build/tools/stf/iosdevice.json')
        let localDevices = JSON.parse(localFile)
          if(localDevices[udid]) {
            return udid
          }
          else if(options.udidStorage !== 'false') {
            try {
              if(JSON.parse(fs.readFileSync(options.udidStorage))[udid]) {
                return udid
              }
            }
            catch(e) {
              log.error('Faile to get udid from remote file with exception : ', e)
            }
          }
          else {
            log.error(`Can't conect device with id ${udid}, please register him`)
        }
      },
}

module.exports = iosutil
