import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import logger from '../../../util/logger.js';
import srv from '../../../util/srv.js';
import lifecycle from '../../../util/lifecycle.js';
import zmqutil from '../../../util/zmqutil.js';
export default syrup.serial()
    .define(function (options) {
    var log = logger.createLogger('device:support:push');
    var push = zmqutil.socket('push');
    return Promise.map(options.endpoints.push, function (endpoint) {
        return srv.resolve(endpoint).then(function (records) {
            return srv.attempt(records, function (record) {
                log.info('Ios device sending output to "%s"', record.url);
                push.connect(record.url);
                return Promise.resolve(true);
            });
        });
    })
        .catch(function (err) {
        log.fatal('Unable to connect to sub endpoint', err);
        lifecycle.fatal(err);
    })
        .return(push);
});
