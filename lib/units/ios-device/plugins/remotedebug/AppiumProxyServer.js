const http = require('http')
const Promise = require('bluebird')

function AppiumProxyServer(options) {
    this.connection = null
    this.minPort = options.minPort
    this.maxPort = options.maxPort
    this.appiumPort = options.appiumPort
    this.host = options.host
    let URI = ''

    const setURI = (host, port) => {
        URI = `${host}:${port}`
    }

    const getRandomPortFromRange = () => {
        return Math.floor(Math.random() * (this.maxPort - this.minPort) + this.minPort)
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
            const randomPortFromRange = getRandomPortFromRange()
            try {
                const server = http.createServer(requestHandler)
                server.listen(randomPortFromRange, (err) => {
                    setURI(this.host, randomPortFromRange)
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
