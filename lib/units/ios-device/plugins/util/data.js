import syrup from '@devicefarmer/stf-syrup';
import deviceData from '@devicefarmer/stf-device-db';
import logger from '../../../../util/logger.js';
import identitySyrup from './identity.js';
export default syrup.serial()
    .dependency(identitySyrup)
    .define(function (_options, identity) {
    var log = logger.createLogger('device:plugins:data');
    var data = deviceData.find(identity);
    if (!data) {
        log.warn('Unable to find device data', identity);
    }
    return data;
});
