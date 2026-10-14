import util from 'util';
import url from 'url';
import syrup from '@devicefarmer/stf-syrup';
import Promise from 'bluebird';
import request from '@cypress/request';
import logger from '../../../util/logger.js';
function isStoredFile(value) {
    return typeof value === 'object' && value !== null && 'href' in value;
}
export default syrup.serial()
    .define(function (options) {
    var log = logger.createLogger('device:support:storage');
    var plugin = Object.create(null);
    plugin.store = function (type, stream, meta) {
        var resolve_, reject_;
        var promise = new Promise(function (resolve, reject) {
            resolve_ = resolve;
            reject_ = reject;
        });
        var args = {
            url: url.resolve(options.storageUrl, util.format('s/upload/%s', type))
        };
        var req = request.post(args, function (err, res, body) {
            if (err) {
                log.error('Upload to "%s" failed', args.url, err.stack);
                reject_(err);
            }
            else if (res.statusCode !== 201) {
                log.error('Upload to "%s" failed: HTTP %d', args.url, res.statusCode);
                reject_(new Error(util.format('Upload to "%s" failed: HTTP %d', args.url, res.statusCode)));
            }
            else {
                try {
                    var result = JSON.parse(body);
                    var file = result.resources?.file;
                    if (!isStoredFile(file)) {
                        throw new Error('Invalid storage response');
                    }
                    log.info('Uploaded to "%s"', file.href);
                    resolve_(file);
                }
                catch (error) {
                    log.error('Invalid JSON in response', error.stack, body);
                    reject_(error);
                }
            }
        });
        req.form()
            .append('file', stream, meta);
        return promise;
    };
    return plugin;
});
