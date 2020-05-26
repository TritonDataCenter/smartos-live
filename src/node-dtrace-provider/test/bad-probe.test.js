var test = require('tap').test;
var fmt = require('util').format;
var d = require('../dtrace-provider');


test('firing non-existent probes', function (t) {
    var provider = d.createDTraceProvider("nodeapp");
    provider['typenull'] = null;
    provider['typeobj1'] = {};
    provider['typeobj2'] = { fire: 5 };
    provider['typenan'] = provider;
    provider['typenum'] = 10;

    function cb(p) {
        return [1, 2, 3, 4];
    }

    function tryName(name) {
        provider.fire(name, cb);
        t.pass(fmt('fire("%s", cb) should not raise SIGABRT', name));
    }

    tryName('kaboom');
    tryName('fire');
    tryName('toString');
    tryName('typenull');
    tryName('typeobj1');
    tryName('typeobj2');
    tryName('typenan');
    tryName('typenum');

    t.end();
});
