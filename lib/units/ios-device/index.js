import { createRequire } from 'module';
import syrup from '@devicefarmer/stf-syrup';
import logger from '../../util/logger.js';
import lifecycle from '../../util/lifecycle.js';
var require = createRequire(import.meta.url);
export default function (options) {
    logger.setGlobalIdentifier(options.serial);
    return syrup.serial()
        .dependency(require('./plugins/logger.js').default)
        .define(function (options) {
        var log = logger.createLogger('ios-device');
        log.info('Preparing device options: ', options);
        return syrup.serial()
            .dependency(require('./plugins/heartbeat.js').default)
            .dependency(require('./plugins/solo.js').default)
            .dependency(require('./plugins/info/index.js').default)
            .dependency(require('./plugins/wda.js').default)
            .dependency(require('./support/push.js').default)
            .dependency(require('./support/sub.js').default)
            .dependency(require('./plugins/group.js').default)
            .dependency(require('./support/storage.js').default)
            .dependency(require('./plugins/devicelog.js').default)
            .dependency(require('./plugins/screen/stream.js').default)
            .dependency(require('./plugins/install.js').default)
            .dependency(require('./plugins/reboot.js').default)
            .dependency(require('./plugins/clipboard.js').default)
            .dependency(require('./plugins/remotedebug.js').default)
            .define(function (options, heartbeat, solo, info, wda, ..._rest) {
            if (process.send) {
                process.send('ready');
            }
            try {
                wda.connect();
                solo.poke();
            }
            catch (err) {
                log.error('err :', err);
            }
        })
            .consume(options);
    })
        .consume(options)
        .catch(function (err) {
        logger.createLogger('ios-device').fatal('Setup had an error', err.stack);
        lifecycle.fatal(err);
    });
}
