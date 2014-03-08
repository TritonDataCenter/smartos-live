# tl;dr

Node.js unit testing is kind of a ghetto. Most of the runners have some
goofy side-effect that makes me hate them.
[nodeunit](https://github.com/caolan/nodeunit) is the only one I've used
that I like the way it acts, but the API is pretty ugly.  This is a simple
wrapper that makes it look sane, with `before`, `after`, and `test`.

It also wraps up everything into domains so that random uncaught stuff actually
works with the test framework.

# Usage

```javascript
var http = require('http');

// This does hack up the global namespace so you don't have to put some
// var test = nodeunitPlus.test; at the top of every file.
require('../index');


before(function (cb) {
    this.server = http.createServer(function (req, res) {
       res.writeHead(200);
       res.end();
    });
    this.server.listen(cb);
});


after(function (cb) {
    this.server.close(cb);
});


test('get /', function (t) {
    var opts = {
        agent: false,
        hostname: '127.0.0.1',
        port: this.server.address().port,
        path: '/'
    };
    http.get(opts, function (res) {
        t.ok(res);
        t.equal(res.statusCode, 200);
        t.end();
    });
});
```


# License

MIT
