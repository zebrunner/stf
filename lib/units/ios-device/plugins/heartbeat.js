import syrup from '@devicefarmer/stf-syrup';
import lifecycle from '../../../util/lifecycle.js';
import wire from '../../../wire/index.js';
import wireutil from '../../../wire/util.js';
import pushSyrup from '../support/push.js';
export default syrup.serial()
    .dependency(pushSyrup)
    .define(function (options, push) {
    function beat() {
        push.send([
            wireutil.global,
            wireutil.envelope(new wire.DeviceHeartbeatMessage(options.serial))
        ]);
    }
    var timer = setInterval(beat, options.heartbeatInterval);
    lifecycle.observe(function () {
        clearInterval(timer);
    });
});
