import { spawn } from 'child_process';
import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import wire from '../../../wire/index.js';
import wireutil from '../../../wire/util.js';
import dbapi from '../../../db/api.js';
import pushSyrup from '../support/push.js';
import routerSyrup from '../support/router.js';
import subSyrup from '../support/sub.js';
import groupSyrup from './group.js';
export default syrup
    .serial()
    .dependency(pushSyrup)
    .dependency(routerSyrup)
    .dependency(subSyrup)
    .dependency(groupSyrup)
    .define(function (options, push, router, _sub, group) {
    var launchArgs = [
        '--id',
        options.serial,
        '--verbose',
        '--debug',
        '--noinstall',
        '--bundle'
    ];
    var DeviceLogger = {
        appOptions: {},
        channel: '',
        stream: null,
        setChannel: function (channel) {
            this.channel = channel;
        },
        startLoggging: function (channel, deviceData) {
            var that = this;
            that.channel = channel;
            if (deviceData &&
                deviceData.bundleName.length !== 0 &&
                deviceData.bundleName.substr(-4) === '.app') {
                group.get().then(function (currentGroup) {
                    launchArgs.push(deviceData.bundleName);
                    that.stream = spawn('ios-deploy1', launchArgs, {
                        shell: true,
                        cwd: deviceData.pathToApp
                    });
                    that.stream.stdout?.on('data', function (data) {
                        if (!that.stream?.pid) {
                            return;
                        }
                        push.send([
                            currentGroup.group,
                            wireutil.envelope(new wire.DeviceLogcatEntryMessage(options.serial, new Date().getTime() / 1000, that.stream.pid, that.stream.pid, 1, 'device:log:cat', data.toString()))
                        ]);
                    });
                    that.stream.on('close', function () {
                    });
                });
            }
        },
        killLoggingProcess: function () {
            if (this.stream?.pid) {
                process.kill(-this.stream.pid);
                this.stream.kill();
                this.stream = null;
                this.channel = '';
            }
        }
    };
    group.on('leave', DeviceLogger.killLoggingProcess.bind(DeviceLogger));
    router
        .on(wire.LogcatStartMessage, function (channel, message) {
        var reply = wireutil.reply(options.serial);
        dbapi.loadDeviceBySerial(options.serial).then(function (device) {
            var data = device?.installedApps?.filter(function (item) {
                return item.bundleName === message.filters[0]?.tag;
            }) || [];
            DeviceLogger.startLoggging(channel.toString(), data[0]);
        });
        push.send([channel, reply.okay('success')]);
    })
        .on(wire.LogcatStopMessage, function () {
        DeviceLogger.killLoggingProcess();
    })
        .on(wire.GroupMessage, function (channel) {
        DeviceLogger.channel = channel.toString();
    });
    return Promise.resolve();
});
