var util = require('util')

var split = require('split')
var Promise = require('bluebird')

var devutil = module.exports = Object.create(null)

function closedError(err) {
  return err.message.indexOf('closed') !== -1
}

devutil.ensureUnusedLocalSocket = function(adb, serial, sock) {
  return adb.openLocal(serial, sock)
    .then(function(conn) {
      conn.end()
      throw new Error(util.format('Local socket "%s" should be unused', sock))
    })
    .catch(closedError, function() {
      return Promise.resolve(sock)
    })
}

devutil.waitForLocalSocket = function(adb, serial, sock) {
  return adb.openLocal(serial, sock)
    .then(function(conn) {
      conn.sock = sock
      return conn
    })
    .catch(closedError, function() {
      return Promise.delay(100)
        .then(function() {
          return devutil.waitForLocalSocket(adb, serial, sock)
        })
    })
}

devutil.listPidsByComm = function(adb, serial, comm, bin) {
  var users = {
    shell: true
  }

  return adb.shell(serial, ['ps'])
    .then(function(out) {
      return new Promise(function(resolve) {
        var header = true
        var pids = []
        out.pipe(split())
          .on('data', function(chunk) {
            if (header) {
              header = false
            }
            else {
              var cols = chunk.toString().split(/\s+/)
              if (cols.pop() === bin && users[cols[0]]) {
                pids.push(Number(cols[1]))
              }
            }
          })
          .on('end', function() {
            resolve(pids)
          })
      })
    })
}

devutil.waitForProcsToDie = function(adb, serial, comm, bin) {
  return devutil.listPidsByComm(adb, serial, comm, bin)
    .then(function(pids) {
      if (pids.length) {
        return Promise.delay(100)
          .then(function() {
            return devutil.waitForProcsToDie(adb, serial, comm, bin)
          })
      }
    })
}

devutil.killProcsByComm = function(adb, serial, comm, bin, mode) {
  return devutil.listPidsByComm(adb, serial, comm, bin, mode)
    .then(function(pids) {
      if (!pids.length) {
        return Promise.resolve()
      }
      return adb.shell(serial, ['kill', mode || -15].concat(pids))
        .then(function(out) {
          return new Promise(function(resolve) {
            out.on('end', resolve)
          })
        })
        .then(function() {
          return devutil.waitForProcsToDie(adb, serial, comm, bin)
        })
        .timeout(2000)
        .catch(function() {
          return devutil.killProcsByComm(adb, serial, comm, bin, -9)
        })
    })
}

devutil.makeIdentity = function(serial, properties) {
  var model = properties['ro.product.model']
  var brand = properties['ro.product.brand']
  var manufacturer = properties['ro.product.manufacturer']
  var operator = properties['gsm.sim.operator.alpha'] ||
        properties['gsm.operator.alpha']
  var version = properties['ro.build.version.release']
  var sdk = properties['ro.build.version.sdk']
  var abi = properties['ro.product.cpu.abi']
  var product = properties['ro.product.name']

  // Remove brand prefix for consistency
  if (model.substr(0, brand.length) === brand) {
    model = model.substr(brand.length)
  }

  // Remove manufacturer prefix for consistency
  if (model.substr(0, manufacturer.length) === manufacturer) {
    model = model.substr(manufacturer.length)
  }

 // update model name for human readavle values based on QAPROSOFT cloud
/*  var models = {"ZX1G22B3M6":"Motorola_Nexus_6", "05157df5e2c1cc2c":"Samsung_Galaxy_S6", "e5a186e407c81de5":"Samsung_Galaxy_Tab_4",
         "ce0217124acd220405":"Samsung_Galaxy_S7", "410053d1c8c59191":"Samsung_Galaxy_Note_4"};
*/
  var device_udid = process.env.DEVICEUDID
  var device_name = process.env.DEVICENAME
  console.log("Attacted device udid: " + device_udid + "; name: " + device_name)


  if (serial == device_udid) {
    model = device_name
  }

/*  if (models[serial] != null) {
    console.log('PROSOFT: Updating model name from "%s" to "%s" for device "%s"', model, models[serial], serial);  
    model = models[serial]
  } else {
        console.log('PROSOFT: Undefined serial "%s" provided for model "%s"! Contact to vdelendik@qaprosoft.com to fix.', serial, model )
  }
*/
  // Clean up remaining model name
  // model = model.replace(/[_ ]/g, '')
  return {
    serial: serial
  , platform: 'Android'
  , manufacturer: manufacturer.toUpperCase()
  , operator: operator || null
  , model: model
  , version: version
  , abi: abi
  , sdk: sdk
  , product: product
  }
}
