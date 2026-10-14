import syrup from '@devicefarmer/stf-syrup';
import devutil from '../../../../util/devutil.js';
import logger from '../../../../util/logger.js';
import displaySyrup from './display.js';
import phoneSyrup from './phone.js';
export default syrup.serial()
    .dependency(displaySyrup)
    .dependency(phoneSyrup)
    .define(function (options, display, phone) {
    var log = logger.createLogger('device:plugins:identity');
    log.info('Solving identity');
    var identity = devutil.makeIdentity(options.serial, {});
    identity.display = display.properties;
    identity.phone = phone;
    return identity;
});
