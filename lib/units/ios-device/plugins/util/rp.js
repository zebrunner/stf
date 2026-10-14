import Promise from 'bluebird';
import request from '@cypress/request';
export default function rp(options) {
    return new Promise(function (resolve, reject) {
        request(options, function (err, response, body) {
            var responseBody = body;
            if (err) {
                var requestError = new Error(String(err));
                requestError.name = 'RequestError';
                requestError.cause = err;
                requestError.error = err;
                requestError.options = options;
                reject(requestError);
                return;
            }
            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                resolve(responseBody);
                return;
            }
            var statusCode = response.statusCode || 0;
            var statusError = new Error(statusCode + ' - ' + (typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)));
            statusError.name = 'StatusCodeError';
            statusError.statusCode = statusCode;
            statusError.error = responseBody;
            statusError.options = options;
            statusError.response = response;
            reject(statusError);
        });
    });
}
