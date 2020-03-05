const fs = require('fs')
const path = require('path')

let iosutil = {
    checkDevice: function(options, udid, log) {
        // TODO: add extra device verification logic if needed
        return udid
      },
}

module.exports = iosutil
