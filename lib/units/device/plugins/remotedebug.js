import syrup from '@devicefarmer/stf-syrup';
import wire from '../../../wire/index.js';
import wireutil from '../../../wire/util.js';
import logger from '../../../util/logger.js';
import groupSyrup from './group.js';
import pushSyrup from '../support/push.js';
export default syrup.serial()
    .dependency(groupSyrup)
    .dependency(pushSyrup)
    .define(function (options, group, push) {
    var log = logger.createLogger('device:plugins:remotedebug');
    function updateRemoteConnectUrl(currentGroup) {
        push.send([
            currentGroup.group,
            wireutil.envelope(new wire.UpdateRemoteConnectUrl(options.serial))
        ]);
    }
    group.on('join', function (currentGroup) {
        updateRemoteConnectUrl(currentGroup);
    });
    group.on('leave', function () {
        log.info('Remote debug group left');
    });
});
