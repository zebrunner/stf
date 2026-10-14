import syrup from '@devicefarmer/stf-syrup';
import logger from '../../../../util/logger.js';
export default syrup.serial()
    .define(function () {
    logger.createLogger('device:plugins:phone');
    return {};
});
