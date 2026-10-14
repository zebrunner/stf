import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import zmqutil from '../../../util/zmqutil.js';
import logger from '../../../util/logger.js';
import srv from '../../../util/srv.js';
import lifecycle from '../../../util/lifecycle.js';
export default syrup
    .serial()
    .define(function (options) {
    var log = logger.createLogger('dev');
    var appDealer = zmqutil.socket('dealer');
    return Promise.map(options.endpoints.appDealer, function (endpoint) {
        return srv.resolve(endpoint).then(function (records) {
            return srv.attempt(records, function (record) {
                log.info('App dealer connected to "%s"', record.url);
                appDealer.connect(record.url);
                return Promise.resolve(true);
            });
        });
    })
        .catch(function (err) {
        log.fatal('Unable to connect to app dealer endpoint', err);
        lifecycle.fatal(err);
    })
        .return(appDealer);
});
