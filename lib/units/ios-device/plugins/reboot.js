import { exec } from 'child_process';
import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import logger from '../../../util/logger.js';
import wire from '../../../wire/index.js';
import wireutil from '../../../wire/util.js';
import routerSyrup from '../support/router.js';
import pushSyrup from '../support/push.js';
export default syrup.serial()
    .dependency(routerSyrup)
    .dependency(pushSyrup)
    .define(function (options, router, push) {
    var log = logger.createLogger('device:plugins:reboot');
    router.on(wire.RebootMessage, function (channel) {
        var reply = wireutil.reply(options.serial);
        var udid = options.serial;
        exec(`ios reboot --udid=${udid}`);
        Promise.delay(5000)
            .then(function () {
            push.send([
                channel,
                reply.okay()
            ]);
        })
            .error(function (err) {
            log.error('Reboot failed', err.stack);
            push.send([
                channel,
                reply.fail(err.message)
            ]);
        });
    });
});
