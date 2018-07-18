var dbapi = require('../../../db/api')

module.exports = function(socket, next) {
  var req = socket.request
  var token = req.session.jwt
  //var token = {'email': 'dimatsurkan93@gmail.com', 'jwt': 'tokenJwt', 'title': 'tokenTitle', 'id': '30awdoawdaw123'}
  //console.log(' ~~~~~~~~~~~~~ trying to pass authentication ~~~~~~~')
  if (token) {
    return dbapi.loadUser(token.email)
      .then(function(user) {
        if (user) {
          req.user = user
          next()
        }
        else {
          next(new Error('Invalid user'))
        }
      })
      .catch(next)
  }
  else {
    next(new Error('Missing authorization token'))
  }
}
