import crypto from 'crypto';
import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import logger from '../../../util/logger.js';
import wire from '../../../wire/index.js';
import lifecycle from '../../../util/lifecycle.js';
import wireutil from '../../../wire/util.js';
import subSyrup from '../support/sub.js';
import pushSyrup from '../support/push.js';
import infoSyrup from './info/index.js';
export default syrup.serial()
    .dependency(subSyrup)
    .dependency(pushSyrup)
    .dependency(infoSyrup)
    .define(function (options, sub, push, info) {
    var log = logger.createLogger('device:plugins:solo');
    function makeChannelId() {
        var hash = crypto.createHash('sha1');
        hash.update(options.serial);
        return hash.digest('base64');
    }
    var channel = makeChannelId();
    log.info('Subscribing to permanent channel "%s"', channel);
    sub.subscribe(channel);
    return {
        channel: channel,
        poke: function () {
            info.manageDeviceInfo()
                .then(function () {
                Promise.delay(3 * 1000)
                    .then(function () {
                    push.send([
                        wireutil.global,
                        wireutil.envelope(new wire.DeviceReadyMessage(options.serial, channel))
                    ]);
                });
            })
                .catch(function (err) {
                log.error('catch managerinfo', err);
                lifecycle.fatal(err);
            });
        }
    };
});
