import net from 'net';
import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import request from '../util/rp.js';
import logger from '../../../../util/logger.js';
import iosutil from '../util/iosutil.js';
import wireutil from '../../../../wire/util.js';
import wire from '../../../../wire/index.js';
import lifecycle from '../../../../util/lifecycle.js';
import timeutil from '../../../../util/timeutil.js';
import dbapi from '../../../../db/api.js';
import notifierSyrup from '../devicenotifier.js';
import pushSyrup from '../../support/push.js';
const LOG_REQUEST_MSG = 'Request has been sent to WDA with data: ';
var NO_RESULT;
function getErrorMessage(err) {
    var body = err;
    return body.error?.value?.message || '';
}
function numericDisplayValue(display, key) {
    var value = display[key];
    return typeof value === 'number' ? value : null;
}
export default syrup.serial()
    .dependency(notifierSyrup)
    .dependency(pushSyrup)
    .define(function (options, notifier, push) {
    var log = logger.createLogger('wdaClient');
    log.info('WdaClient.js initializing...');
    var socket = new net.Socket();
    var WdaClient = {
        baseUrl: iosutil.getUri(options.wdaHost, options.wdaPort),
        sessionId: null,
        deviceSize: null,
        orientation: null,
        touchDownParams: {},
        tapStartAt: 0,
        typeKeyActions: [],
        typeKeyTimerId: null,
        typeKeyDelay: 250,
        upperCase: false,
        isSwiping: false,
        isRotating: false,
        deviceType: null,
        getDeviceType: function () {
            if (this.deviceType !== null) {
                return this.deviceType;
            }
            return dbapi.getDeviceType(options.serial).then((deviceType) => {
                if (!deviceType) {
                    return null;
                }
                log.info('Reusing device type value: ', deviceType);
                this.deviceType = deviceType;
                return this.deviceType;
            }).catch(function (err) {
                log.error('Error getting device type from DB');
                lifecycle.fatal(err);
                return null;
            });
        },
        startSession: function () {
            log.info('verifying wda session status...');
            this.getDeviceType();
            var params = {
                capabilities: {}
            };
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session`,
                body: params,
                json: true
            })
                .then((sessionResponse) => {
                return this.handleRequest({
                    method: 'GET',
                    uri: `${this.baseUrl}/status`,
                    json: true
                })
                    .then((statusResponse) => {
                    log.info(`status response: ${JSON.stringify(statusResponse)}`);
                    if (statusResponse.sessionId) {
                        this.sessionId = statusResponse.sessionId;
                        log.info(`reusing existing wda session: ${this.sessionId}`);
                        this.setStatus(3);
                        if (this.deviceType !== 'Apple TV') {
                            this.getOrientation();
                            this.batteryIosEvent();
                        }
                        this.setVersion(sessionResponse);
                        return this.size();
                    }
                    log.info('starting wda session...');
                    return this.handleRequest({
                        method: 'POST',
                        uri: `${this.baseUrl}/session`,
                        body: params,
                        json: true
                    })
                        .then((newSessionResponse) => {
                        log.info(`startSession response: ${JSON.stringify(newSessionResponse)}`);
                        this.setVersion(newSessionResponse);
                        this.sessionId = newSessionResponse.sessionId;
                        log.info(`sessionId: ${this.sessionId}`);
                        if (this.deviceType !== 'Apple TV') {
                            this.getOrientation();
                            this.batteryIosEvent();
                        }
                        this.setStatus(3);
                        return this.size();
                    })
                        .catch((err) => {
                        log.error('"startSession" No valid response from web driver!', err);
                        return Promise.reject(err);
                    });
                });
            });
        },
        stopSession: function () {
            log.info('stopping wda session: ', this.sessionId);
            var currentSessionId = this.sessionId;
            this.sessionId = null;
            if (currentSessionId === null) {
                return Promise.resolve();
            }
            return this.handleRequest({
                method: 'DELETE',
                uri: `${this.baseUrl}/session/${currentSessionId}`
            });
        },
        setStatus: function (status) {
            push.send([
                wireutil.global,
                wireutil.envelope(new wire.DeviceStatusMessage(options.serial, status, timeutil.now('nano')))
            ]);
        },
        typeKey: function (params) {
            var rawValue = params.value?.[0];
            if (!rawValue) {
                return;
            }
            var value = rawValue;
            if (this.upperCase) {
                value = value.toUpperCase();
            }
            this.typeKeyActions.push({ type: 'keyDown', value: value });
            this.typeKeyActions.push({ type: 'keyUp', value: value });
            var handleRequest = () => {
                var requestParams = {
                    method: 'POST',
                    uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
                    body: {
                        actions: [
                            {
                                type: 'key',
                                id: 'keyboard',
                                actions: this.typeKeyActions
                            }
                        ]
                    },
                    json: true
                };
                this.typeKeyActions = [];
                if (this.typeKeyTimerId) {
                    clearTimeout(this.typeKeyTimerId);
                    this.typeKeyTimerId = null;
                }
                if (this.deviceType !== 'Apple TV') {
                    this.handleRequest(requestParams);
                    return NO_RESULT;
                }
                switch (true) {
                    case value === '\v':
                        this.pressButton('left');
                        return NO_RESULT;
                    case value === '\f':
                        this.pressButton('right');
                        return NO_RESULT;
                    case value === '\0':
                        this.pressButton('up');
                        return NO_RESULT;
                    case value === '\x18':
                        this.pressButton('down');
                        return NO_RESULT;
                    case value === '\r':
                        this.pressButton('select');
                        return NO_RESULT;
                    default:
                        return NO_RESULT;
                }
            };
            if (value === ' ') {
                handleRequest();
            }
            else {
                if (this.typeKeyTimerId) {
                    clearTimeout(this.typeKeyTimerId);
                }
                this.typeKeyTimerId = setTimeout(handleRequest, this.typeKeyDelay);
            }
        },
        tap: function (params) {
            this.tapStartAt = (new Date()).getTime();
            this.touchDownParams = params;
        },
        homeBtn: function () {
            if (this.deviceType !== 'Apple TV') {
                return this.handleRequest({
                    method: 'POST',
                    uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                    body: { name: 'home' },
                    json: true
                }).then(() => {
                    return this.rotation({ orientation: 'PORTRAIT' });
                });
            }
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: { name: 'menu' },
                json: true
            });
        },
        swipe: function (params) {
            if (!this.deviceSize) {
                return NO_RESULT;
            }
            var scale = iosutil.swipe(this.orientation, params, this.deviceSize);
            var body = {
                actions: [
                    {
                        type: 'pointer',
                        id: 'finger1',
                        parameters: { pointerType: 'touch' },
                        actions: [
                            { type: 'pointerMove', duration: 0, x: scale.fromX, y: scale.fromY },
                            {
                                type: 'pointerMove',
                                duration: scale.duration * 1000,
                                x: scale.toX,
                                y: (function () {
                                    if (scale.fromY < scale.toY) {
                                        return scale.toY - (scale.toY / 4);
                                    }
                                    if (scale.fromY - scale.toY >= 50) {
                                        return scale.toY + (scale.toY / 4);
                                    }
                                    return scale.toY;
                                })()
                            },
                            { type: 'pointerUp' }
                        ]
                    }
                ]
            };
            if (this.deviceType === 'Apple TV') {
                log.error('Swipe is not supported');
                return NO_RESULT;
            }
            if (!this.isSwiping) {
                this.isSwiping = true;
                this.handleRequest({
                    method: 'POST',
                    uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
                    body: body,
                    json: true
                }).then((response) => {
                    log.info('swipe response: ', response);
                    this.isSwiping = false;
                });
            }
            return NO_RESULT;
        },
        touchUp: function () {
            if (this.isSwiping || !this.deviceSize) {
                return NO_RESULT;
            }
            var x = this.touchDownParams.x;
            var y = this.touchDownParams.y;
            if (typeof x !== 'number' || typeof y !== 'number') {
                return NO_RESULT;
            }
            x *= this.deviceSize.width;
            y *= this.deviceSize.height;
            if (((new Date()).getTime() - this.tapStartAt) <= 1000 || !this.tapStartAt) {
                var body = {
                    actions: [
                        {
                            type: 'pointer',
                            id: 'finger1',
                            parameters: { pointerType: 'touch' },
                            actions: [
                                {
                                    type: 'pointerMove',
                                    duration: 0,
                                    x: this.orientation === 'PORTRAIT' ? x : y,
                                    y: this.orientation === 'PORTRAIT' ? y : x
                                },
                                {
                                    type: 'pointerMove',
                                    duration: 0,
                                    x: this.orientation === 'PORTRAIT' ? x : y,
                                    y: this.orientation === 'PORTRAIT' ? y : x
                                },
                                { type: 'pointerUp' }
                            ]
                        }
                    ]
                };
                if (this.deviceType !== 'Apple TV') {
                    log.info(options.deviceName);
                    return this.handleRequest({
                        method: 'POST',
                        uri: `${this.baseUrl}/session/${this.sessionId}/actions`,
                        body: body,
                        json: true
                    });
                }
                if (x >= 0 && y >= 0) {
                    switch (true) {
                        case x < 300:
                            return this.pressButton('left');
                        case x > 1650:
                            return this.pressButton('right');
                        case y > 850:
                            return this.pressButton('down');
                        case y < 250:
                            return this.pressButton('up');
                        default:
                            return this.pressButton('select');
                    }
                }
            }
            else {
                if (this.deviceType === 'Apple TV') {
                    log.error('Holding tap is not supported');
                    return NO_RESULT;
                }
                return this.handleRequest({
                    method: 'POST',
                    uri: `${this.baseUrl}/session/${this.sessionId}/wda/touchAndHold`,
                    body: { x: x, y: y, duration: 1 },
                    json: true
                });
            }
            return NO_RESULT;
        },
        tapDeviceTreeElement: function (message) {
            var params = {
                using: 'link text',
                value: 'label=' + message.label
            };
            return new Promise((resolve) => {
                this.handleRequest({
                    method: 'POST',
                    uri: `${this.baseUrl}/session/${this.sessionId}/elements`,
                    body: params,
                    json: true
                })
                    .then((response) => {
                    var element = response.value[0];
                    var elementId = element?.ELEMENT || element?.['element-6066-11e4-a52e-4f735466cecf'];
                    if (!elementId) {
                        return NO_RESULT;
                    }
                    return this.handleRequest({
                        method: 'POST',
                        uri: `${this.baseUrl}/session/${this.sessionId}/element/${elementId}/click`,
                        body: {},
                        json: true
                    });
                })
                    .then(resolve)
                    .catch(function (err) {
                    log.error(err);
                    resolve(NO_RESULT);
                });
            });
        },
        doubleClick: function () {
            if (!this.isSwiping && this.deviceSize) {
                var x = this.touchDownParams.x;
                var y = this.touchDownParams.y;
                if (typeof x !== 'number' || typeof y !== 'number') {
                    return NO_RESULT;
                }
                var params = {
                    x: x * this.deviceSize.width,
                    y: y * this.deviceSize.height
                };
                return this.handleRequest({
                    method: 'POST',
                    uri: `${this.baseUrl}/session/${this.sessionId}/wda/doubleTap`,
                    body: params,
                    json: true
                });
            }
            return NO_RESULT;
        },
        size: function () {
            if (this.deviceSize !== null) {
                return this.deviceSize;
            }
            log.info('getting device window size...');
            return dbapi.getDeviceSize(options.serial).then((deviceSize) => {
                if (!deviceSize) {
                    return null;
                }
                var dbHeight = numericDisplayValue(deviceSize, 'height');
                var dbWidth = numericDisplayValue(deviceSize, 'width');
                var dbScale = numericDisplayValue(deviceSize, 'scale');
                if (!dbHeight || !dbWidth || !dbScale) {
                    return null;
                }
                log.info('Reusing device size/scale');
                if (this.orientation === 'PORTRAIT' || !this.orientation) {
                    this.deviceSize = { height: dbHeight / dbScale, width: dbWidth / dbScale };
                }
                else if (this.orientation === 'LANDSCAPE') {
                    this.deviceSize = { height: dbWidth / dbScale, width: dbHeight / dbScale };
                }
                else if (this.deviceType === 'Apple TV') {
                    this.deviceSize = { height: dbHeight, width: dbWidth };
                }
                return this.deviceSize;
            })
                .catch(function (err) {
                log.error('Error getting device size from DB');
                lifecycle.fatal(err);
            });
        },
        setVersion: function (currentSession) {
            log.info('Setting current device version: ' + currentSession.value.capabilities.sdkVersion);
            push.send([
                wireutil.global,
                wireutil.envelope(new wire.SdkIosVersion(options.serial, currentSession.value.capabilities.device, currentSession.value.capabilities.sdkVersion))
            ]);
        },
        openUrl: function (message) {
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/url`,
                body: { url: message.url },
                json: true
            });
        },
        screenshot: function () {
            return new Promise((resolve, reject) => {
                this.handleRequest({
                    method: 'GET',
                    uri: `${this.baseUrl}/screenshot`,
                    json: true
                })
                    .then(resolve)
                    .catch(reject);
            });
        },
        getOrientation: function () {
            return this.handleRequest({
                method: 'GET',
                uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
                json: true
            }).then((orientationResponse) => {
                this.orientation = orientationResponse.value;
                log.info('Current device orientation: ' + this.orientation);
            });
        },
        rotation: function (params) {
            this.orientation = params.orientation;
            this.isRotating = true;
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
                body: params,
                json: true
            }).then(() => {
                this.getOrientation();
                this.size();
                var rotationDegrees = iosutil.orientationToDegrees(this.orientation);
                push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.RotationEvent(options.serial, rotationDegrees))
                ]);
                this.isRotating = false;
            });
        },
        batteryIosEvent: function () {
            return this.handleRequest({
                method: 'GET',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/batteryInfo`,
                json: true
            })
                .then((batteryInfoResponse) => {
                var batteryState = iosutil.batteryState(batteryInfoResponse.value.state);
                var batteryLevel = iosutil.batteryLevel(batteryInfoResponse.value.level);
                push.send([
                    wireutil.global,
                    wireutil.envelope(new wire.BatteryIosEvent(options.serial, 'good', 'usb', batteryState, batteryLevel, 'n/a', 100))
                ]);
            })
                .then(function () {
                log.info('Setting new device battery info');
            })
                .catch(function (err) {
                log.info(err);
            });
        },
        getTreeElements: function () {
            return this.handleRequest({
                method: 'GET',
                uri: `${this.baseUrl}/source?format=json`,
                json: true
            });
        },
        pressButton: function (params) {
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/pressButton`,
                body: { name: params },
                json: true
            });
        },
        switchCharset: function () {
            this.upperCase = !this.upperCase;
            log.info(this.upperCase);
        },
        appActivate: function (params) {
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/apps/activate`,
                body: { bundleId: params },
                json: true
            });
        },
        pressPower: function () {
            return this.handleRequest({
                method: 'GET',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/locked`,
                json: true
            })
                .then((response) => {
                var targetUrl = `${this.baseUrl}/session/${this.sessionId}/wda/lock`;
                if (response.value === true) {
                    targetUrl = `${this.baseUrl}/session/${this.sessionId}/wda/unlock`;
                }
                return this.handleRequest({
                    method: 'POST',
                    uri: targetUrl,
                    json: true
                });
            });
        },
        getClipBoard: function () {
            return this.handleRequest({
                method: 'POST',
                uri: `${this.baseUrl}/session/${this.sessionId}/wda/getPasteboard`
            })
                .then(function (res) {
                var parsed = JSON.parse(res);
                var clipboard = Buffer.from(parsed.value, 'base64').toString('utf-8');
                return clipboard || 'No clipboard data';
            });
        },
        handleRequest: function (requestOpt) {
            return new Promise((resolve) => {
                request(requestOpt)
                    .then((response) => {
                    log.verbose(LOG_REQUEST_MSG, JSON.stringify(requestOpt));
                    resolve(response);
                })
                    .catch((err) => {
                    var errMes = getErrorMessage(err);
                    if (errMes.includes('Timed out while waiting until the screen gets locked') ||
                        errMes.includes('unlocked')) {
                        return;
                    }
                    if (errMes.includes('Unable To Rotate Device')) {
                        log.info('The current application does not support rotation');
                        return;
                    }
                    if (errMes.includes('Session does not exist')) {
                        this.startSession();
                        return;
                    }
                    notifier.setDeviceAbsent(err);
                    lifecycle.fatal(err);
                });
            });
        }
    };
    function connectToWdaMjpeg(connectOptions) {
        log.info('connecting to WdaMjpeg');
        socket.connect(connectOptions.connectPort, connectOptions.wdaHost, function () {
            log.info(`Connected to WdaMjpeg ${connectOptions.wdaHost}:${connectOptions.connectPort}`);
        });
        push.send([
            wireutil.global,
            wireutil.envelope(new wire.DeviceStatusMessage(connectOptions.serial, 6, timeutil.now('nano')))
        ]);
    }
    function wdaMjpegCloseEventHandler(hadError) {
        log.info(`WdaMjpeg connection was closed${hadError ? ' by error' : ''}`);
        notifier.setDeviceAbsent('WdaMjpeg connection is lost');
        lifecycle.fatal('WdaMjpeg connection is lost');
        push.send([
            wireutil.global,
            wireutil.envelope(new wire.DeviceStatusMessage(options.serial, 3, timeutil.now('nano')))
        ]);
    }
    socket.on('close', wdaMjpegCloseEventHandler);
    connectToWdaMjpeg(options);
    return WdaClient;
});
