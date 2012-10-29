// expected output:
// 
// $ sudo dtrace -Zn 'nodeapp*:::{ trace(arg0); }' -c 'node test/enabled-again.js'
// dtrace: description 'nodeapp*:::' matched 0 probes
// CPU     ID                    FUNCTION:NAME
//   1   5456                      func:probe1                 1
//   1   5456                      func:probe1                 2

var d = require('../dtrace-provider');
var dtp = d.createDTraceProvider("nodeapp");
dtp.addProbe("probe1", "int");
dtp.enable();
dtp.fire("probe1", function(p) { return [1]; });

for (var i = 0; i < 2500; i++) {
    dtp.enable();
    dtp.fire("probe1", function(p) { return [i]; });
    dtp.disable();
    //gc();
}
dtp.fire("probe1", function(p) { return [42]; });

