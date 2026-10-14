import syrup from '@devicefarmer/stf-syrup';
import dataSyrup from './data.js';
export default syrup.serial()
    .dependency(dataSyrup)
    .define(function (_options, data) {
    return {
        has: function (flag) {
            return data && data.flags && !!data.flags[flag];
        },
        get: function (flag, defaultValue) {
            return data && data.flags && typeof data.flags[flag] !== 'undefined' ?
                data.flags[flag] :
                defaultValue;
        }
    };
});
