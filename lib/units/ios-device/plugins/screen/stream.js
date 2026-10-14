import { Transform } from 'stream';
import syrup from '@devicefarmer/stf-syrup';
import { WebSocketServer } from 'ws';
import websocketStream from 'websocket-stream';
import MjpegConsumer from 'mjpeg-consumer';
import Promise from 'bluebird';
import request from '@cypress/request';
import logger from '../../../../util/logger.js';
import iosutil from '../util/iosutil.js';
import soloSyrup from '../solo.js';
import notifierSyrup from '../devicenotifier.js';
import wdaClientSyrup from '../wda/WdaClient.js';
import pushSyrup from '../../support/push.js';
export default syrup.serial()
    .dependency(soloSyrup)
    .dependency(notifierSyrup)
    .dependency(wdaClientSyrup)
    .dependency(pushSyrup)
    .define(function (options, _solo, notifier, WdaClient, _push) {
    var log = logger.createLogger('device:plugins:screen:stream');
    var wss = new WebSocketServer({ port: options.screenPort });
    var targetUrl = iosutil.getUri(options.wdaHost, options.mjpegPort || options.connectPort);
    wss.on('connection', function (ws) {
        var isConnectionAlive = true;
        var consumer = new MjpegConsumer();
        var frameStream = null;
        var chain = Promise.resolve();
        var stream = websocketStream(ws);
        function handleSocketError(err, message) {
            log.error(message, err);
            notifier.setDeviceTemporaryUnavailable(err);
            ws.close();
        }
        function handleRequestStream() {
            return new Promise(function (resolve, reject) {
                setTimeout(function () {
                    frameStream = request.get(targetUrl);
                    frameStream.on('response', function (response) {
                        reject({ response: response, frameStream: frameStream });
                    });
                    frameStream.on('error', function () {
                        if (isConnectionAlive) {
                            resolve();
                        }
                        else {
                            reject();
                        }
                    });
                }, 1000);
            });
        }
        function getRequestStream() {
            for (var i = 0; i < 10; i++) {
                chain = chain.then(function () {
                    return handleRequestStream();
                });
            }
            chain
                .then(function () {
                return handleSocketError({ message: 'Connection failed to WDA MJPEG port' }, 'Consumer error');
            })
                .catch(function (result) {
                if (result) {
                    var transformStream = new Transform({
                        transform(chunk, _encoding, callback) {
                            if (WdaClient.isSwiping) {
                                ws.send(JSON.stringify({ type: 'swiping', message: 'Swiping detected' }));
                            }
                            callback(null, chunk);
                        }
                    });
                    result.response.pipe(consumer).pipe(transformStream).pipe(stream);
                    WdaClient.startSession();
                    result.frameStream.on('error', function (err) {
                        handleSocketError(err, 'frameStream error');
                    });
                }
            });
        }
        consumer.on('error', function (err) {
            handleSocketError(err, 'Consumer error');
        });
        stream.on('error', function (_err) {
        });
        stream.socket.on('error', function (_err) {
        });
        ws.on('close', function () {
            WdaClient.stopSession();
            isConnectionAlive = false;
            log.important('ws on close event');
        });
        ws.on('error', function () {
            WdaClient.stopSession();
            isConnectionAlive = false;
            log.important('ws on error event');
        });
        getRequestStream();
    });
});
