const http = require('http')
const Promise = require('bluebird')

function AppiumProxyServer(options) {
    this.connection = null
    this.stfAppiumPort = options.stfAppiumPort
    this.appiumPort = options.appiumPort
    this.host = options.publicNodeIp
    let URI = ''

    const setURI = (host, port) => {
        URI = `${host}:${port}`
    }

    const setConnection = (server) => {
        this.connection = server
    }

    const requestHandler = (req, res) => {
        const options = {
            hostname: this.host,
            port: this.appiumPort,
            path: req.url,
            method: req.method,
            headers: req.headers
        }
        
        const proxy = http.request(options, function(proxyResponse) {
        res.writeHead(proxyResponse.statusCode, proxyResponse.headers)
        proxyResponse.pipe(res, {
            end: true
        })
        })
    
        req.pipe(proxy, {
        end: true
        })
    }

    this.getURI = () => URI

    this.connect = () => {
        return new Promise((resolve, reject) => {
            try {
                const server = http.createServer(requestHandler)
                server.listen(this.stfAppiumPort, (err) => {
                    setURI(this.host, this.stfAppiumPort)
                    if (err) {
                        return reject(err)
                    }
                    resolve(this.getURI())
                })
                setConnection(server)
            }
            catch(e) {
                reject(e)
            }
        })
    }

    this.disconnect = () => {
        return new Promise((resolve, reject) => {
            try {
                this.connection.close(() => resolve())
                this.connection = null
            }
            catch(e) {
                reject(e)
            }
        })
    }
}

module.exports = AppiumProxyServer
