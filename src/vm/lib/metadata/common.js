exports.createJsonChunkParser = function (log, handler, delimeter) {
    return (function () {
        var buffer = '';
        var onData = function (data) {
            var chunk, chunks;
            var msg;

            buffer += data.toString();
            chunks = buffer.split(delimeter);
            while (chunks.length > 1) {
                chunk = chunks.shift();
                if (!chunk) {
                    continue;
                }
                try {
                    msg = JSON.parse(chunk.trim());
                    handler(msg);
                } catch (e) {
                    log.error({err: e}, 'failed to parse chunk');
                    handler();
                }
            }
            buffer = chunks.pop();
        };

        return onData;
    }());
};

exports.retryUntil = function (step, max, check, callback) {
    var waited = 0;
    var interval;
    var stop = function () { clearInterval(interval); };

    interval = setInterval(function () {
        waited += step;
        if (waited > max) {
            stop();
            callback(new Error('Timeout'));
            return;
        }

        check(function (error, abort) {
            if (abort) {
                stop();
                callback(error);
            }
        });
    }, step);
};

exports.isString = function (obj) {
    return Object.prototype.toString.call(obj) === '[object String]';
};
