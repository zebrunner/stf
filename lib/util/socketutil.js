var app = require('express')()
var http = require('http').Server(app)
var io = require('socket.io')(http)
var port = 6666
http.listen(port, function(){
  console.log('listening on *:' + port);
});
module.exports = io
