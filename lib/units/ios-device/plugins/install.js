import fs from 'fs';
import http from 'http';
import https from 'https';
import { Readable } from 'stream';
import url from 'url';
import { exec as childExec } from 'child_process';
import syrup from '@devicefarmer/stf-syrup';
import request from '@cypress/request';
import Promise from 'bluebird';
import * as uuid from 'uuid';
import logger from '../../../util/logger.js';
import wire from '../../../wire/index.js';
import wireutil from '../../../wire/util.js';
import promiseutil from '../../../util/promiseutil.js';
import routerSyrup from '../support/router.js';
import pushSyrup from '../support/push.js';
const mkdir = Promise.promisify(fs.mkdir);
function execShellCommand(cmd) {
    return new Promise(function (resolve, reject) {
        childExec(cmd, function (error, stdout) {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}
function installApp(udid, filepath, id, isSimulator) {
    var simulatorCommands = [
        `cd ${filepath} && unzip * && xcrun simctl install ${udid} *.app`
    ];
    var deviceCommands = [
        `ios install --path=${filepath}/${id} --udid=${udid}`
    ];
    var commands = isSimulator ? simulatorCommands : deviceCommands;
    return new Promise(function (resolve, reject) {
        execShellCommand(commands.join(';')).then(function () {
            resolve();
        }).catch(function (err) {
            reject(err);
        });
    });
}
function launchApp(udid, bundleId, isSimulator) {
    var simulatorCommands = [
        `xcrun simctl launch ${udid} ${bundleId}`
    ];
    var deviceCommands = [
        `ios launch ${bundleId} --udid=${udid}`
    ];
    var commands = isSimulator ? simulatorCommands : deviceCommands;
    return new Promise(function (resolve, reject) {
        execShellCommand(commands.join(';')).then(function () {
            resolve();
        }).catch(function (err) {
            reject(err);
        });
    });
}
function isSimulatorManifest(manifest) {
    return Boolean(manifest.DTPlatformName?.includes('simulator'));
}
function uploadRequestForLogging(options, href) {
    var req = request({
        url: url.resolve(options.storageUrl, href || '')
    });
    return new Readable().wrap(req);
}
function createProgressSender(options, push, channel) {
    var reply = wireutil.reply(options.serial);
    return function (data, progress) {
        push.send([
            channel,
            reply.progress(data, progress)
        ]);
    };
}
function downloadFile(downloadUrl, filePath, httpServer, sendProgress) {
    return new Promise(function (resolve, reject) {
        var file = fs.createWriteStream(filePath);
        function handleResponse(response) {
            var totalSize = Number(response.headers['content-length']);
            var pushStart = 50;
            var pushEnd = 60;
            var downloadedSize = 0;
            response.pipe(file);
            response.on('data', function (chunk) {
                downloadedSize += chunk.length;
                sendProgress('pushing_app', Math.round((downloadedSize / totalSize) * (pushEnd - pushStart) + pushStart));
            });
            file.on('finish', function () {
                file.close();
                resolve();
            });
        }
        file.on('error', reject);
        httpServer.get(downloadUrl, handleResponse).on('error', reject);
    });
}
function installDownloadedApp(options, manifest, tmpDirPath, id, sendProgress, log) {
    var start = 60;
    var end = 95;
    var guesstimate = start;
    var isSimulator = isSimulatorManifest(manifest);
    sendProgress('installing_app', guesstimate);
    log.info('isSimulator: ' + isSimulator);
    return promiseutil.periodicNotify(installApp(options.serial, tmpDirPath, id, isSimulator), 250, function () {
        guesstimate = Math.min(end, guesstimate + 1.5 * (end - guesstimate) / (end - start));
        sendProgress('installing_app', guesstimate);
    });
}
function maybeLaunchApp(options, manifest, isSimulator, shouldLaunch, sendProgress, log) {
    if (shouldLaunch) {
        log.info('CFBundleIdentifier: ' + manifest.CFBundleIdentifier);
        sendProgress('launching_app', 100);
        if (manifest.CFBundleIdentifier) {
            launchApp(options.serial, manifest.CFBundleIdentifier, isSimulator);
        }
    }
}
function sendInstallFailure(push, channel, options, manifest, err, log) {
    var errorReply = 'INSTALL_ERROR_UNKNOWN';
    var reply = wireutil.reply(options.serial);
    log.error('Installation of package "%s" failed', manifest.CFBundleIdentifier, err.stack);
    var stack = typeof err.stack === 'string' ? err.stack : '';
    if (stack.includes('ApplicationVerificationFailed')) {
        errorReply = 'INSTALL_ERROR_APP_SIGNING';
    }
    push.send([
        channel,
        reply.fail(errorReply)
    ]);
}
function handleInstall(options, push, log, channel, message) {
    log.info('Installing application from "%s"', message.href);
    var manifest = JSON.parse(message.manifest || '{}');
    var reply = wireutil.reply(options.serial);
    var sendProgress = createProgressSender(options, push, channel);
    var reqInfo = uploadRequestForLogging(options, message.href);
    var id = uuid.v4();
    var tmpDirPath = '/tmp/' + id;
    var filePath = tmpDirPath + '/' + id;
    var httpServer = http;
    var downloadUrl = options.storageUrl.replace(/\/+$/, '') + (message.href || '');
    log.info('regInfo: ' + JSON.stringify(reqInfo));
    log.info('mkdir "%s"', tmpDirPath);
    if (options.storageUrl.includes('https://')) {
        httpServer = https;
    }
    mkdir(tmpDirPath)
        .then(function () {
        log.info('url: ', downloadUrl);
        return downloadFile(downloadUrl, filePath, httpServer, sendProgress);
    })
        .then(function () {
        log.info('Download Completed');
        var isSimulator = isSimulatorManifest(manifest);
        return installDownloadedApp(options, manifest, tmpDirPath, id, sendProgress, log)
            .then(function () {
            maybeLaunchApp(options, manifest, isSimulator, message.launch, sendProgress, log);
        });
    })
        .then(function () {
        push.send([
            channel,
            reply.okay('INSTALL_SUCCEEDED')
        ]);
    })
        .catch(function (err) {
        sendInstallFailure(push, channel, options, manifest, err, log);
    });
}
export default syrup.serial()
    .dependency(routerSyrup)
    .dependency(pushSyrup)
    .define(function (options, router, push) {
    var log = logger.createLogger('device:plugins:install');
    router.on(wire.InstallMessage, function (channel, message) {
        handleInstall(options, push, log, channel, message);
    });
    router.on(wire.UninstallIosMessage, function (channel, message) {
        log.info('UnistallIosMessage, channel', channel);
        log.info('UnistallIosMessage, message', message);
        var _args = [
            '--id', options.serial, ''
        ];
    });
});
