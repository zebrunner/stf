import syrup from '@devicefarmer/stf-syrup';
import wirerouter from '../../../wire/router.js';
import subSyrup from './sub.js';
import channelsSyrup from './channels.js';
export default syrup.serial()
    .dependency(subSyrup)
    .dependency(channelsSyrup)
    .define(function (options, sub, channels) {
    var router = wirerouter();
    sub.on('message', router.handler());
    router.on({ $code: 'message' }, function (channel) {
        channels.keepalive(channel);
    });
    return router;
});
