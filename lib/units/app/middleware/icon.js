var serveStatic = require('serve-static')

module.exports = function(rootDir) {
    return serveStatic(
        `${rootDir}/public/icons`,
        {
            maxAge: '30d'
        }
    )
}
