module.exports.command = 'ios-device'

module.exports.builder = function(yargs) {
  return yargs
    .strict()
    .option('ios-host', {
      describe: 'The ADB server host.'
      , type: 'string'
      , default: '127.0.0.1'
    })
    .option('ios-port', {
      describe: 'The ADB server port.'
      , type: 'number'
      , default: 5037
    })
    .option('serial', {
      describe: 'The Ios serial.'
      , type: 'string'
      , default: 'emnulator-5555'
    })
}

module.exports.handler = function(argv) {
  console.log('output handler argv', argv)
  return require('../../units/ios-device')()
}
