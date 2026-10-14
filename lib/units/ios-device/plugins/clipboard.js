import syrup from '@devicefarmer/stf-syrup';
import wire from '../../../wire/index.js';
import wireutil from '../../../wire/util.js';
import routerSyrup from '../support/router.js';
import pushSyrup from '../support/push.js';
import wdaClientSyrup from './wda/WdaClient.js';
export default syrup.serial()
    .dependency(routerSyrup)
    .dependency(pushSyrup)
    .dependency(wdaClientSyrup)
    .define(function (options, router, push, wdaClient) {
    router.on(wire.CopyMessage, function (channel) {
        var reply = wireutil.reply(options.serial);
        wdaClient.getClipBoard()
            .then(function (clipboard) {
            push.send([
                channel,
                reply.okay(clipboard)
            ]);
        })
            .catch(function () {
            push.send([
                channel,
                reply.fail('')
            ]);
        });
    });
});
