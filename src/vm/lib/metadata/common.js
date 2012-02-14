exports.createJsonChunkParser = function (handler, delimeter) {
  return (function () {
    var buffer = '';
    var onData = function (data) {
      var chunk, chunks;
      buffer += data.toString();
      chunks = buffer.split(delimeter);
      while (chunks.length > 1) {
        chunk = chunks.shift();
        if (!chunk) continue;
        var msg;
        try {
          msg = JSON.parse(chunk.trim());
          handler(msg);
        } catch (e) {
          console.log(e.message);
          console.log(e.stack);
          handler();
        }
      }
      buffer = chunks.pop();
    }

    return onData;
  }());
}

exports.retryUntil = function (step, max, check, callback) {
  var waited = 0;
  var interval;
  var stop = function () { clearInterval(interval) }

  interval = setInterval(function () {
    waited += step;
    if (waited > max) {
      stop();
      return callback(new Error("Timeout"));
    }

    check(function (error, abort) {
      if (abort) {
        stop();
        callback(error);
      }
    });
  }, step);
}

exports.isString = function (obj) {
  return Object.prototype.toString.call(obj) === '[object String]';
}
