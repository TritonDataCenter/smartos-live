// expected output:
// 
// $ sudo dtrace -Zn 'nodeapp*:::{ trace(arg0); }' -c 'node test/enabled_again.js'
// dtrace: description 'nodeapp*:::' matched 0 probes
// CPU     ID                    FUNCTION:NAME
//   1   5456                      func:probe1                 1
//   1   5456                      func:probe1                 2

var d = require('../dtrace-provider');
var dtp = d.createDTraceProvider("nodeapp");
dtp.addProbe("probe1", "int");
dtp.enable();
dtp.fire("probe1", function(p) { return [1]; });

for (var i = 0; i<100; i++) {
    dtp.enable();
}
dtp.fire("probe1", function(p) { return [2]; });
setTimeout(function() { }, 1000);
