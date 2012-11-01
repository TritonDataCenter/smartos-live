// expected output:
//
// $ NODE_PATH=. sudo -E dtrace -Zn 'test*:::{trace(probemod)}' -c 'node test/disambiguation2.js'
// dtrace: description 'test*:::' matched 0 probes
// dtrace: pid 73913 has exited
// CPU     ID                    FUNCTION:NAME
//  0  33495                    probe1:probe1   mymod1
//  0  33498                    probe1:probe1   mymod2

var d = require('dtrace-provider');

var dtp = d.createDTraceProvider('test', 'mymod1');
var p1 = dtp.addProbe('probe1', 'int', 'int');
var p2 = dtp.addProbe('probe2', 'int', 'int');
dtp.enable();

var dtp2 = d.createDTraceProvider('test', 'mymod2');
var p1 = dtp2.addProbe('probe3', 'int', 'int');
var p2 = dtp2.addProbe('probe1', 'int', 'int');
dtp2.enable();

dtp.fire('probe1', function () {
    return ([12, 3]);
});

dtp2.fire('probe1', function () {
    return ([12, 73]);
});
