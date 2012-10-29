var util = require('util');
var d = require('../dtrace-provider');

var dtp = d.createDTraceProvider("testlibusdt");
var p = dtp.addProbe("32probe", "int", "int", "int", "int", "int", "int", "int", "int",
                                "int", "int", "int", "int", "int", "int", "int", "int",
                                "int", "int", "int", "int", "int", "int", "int", "int",
                                "int", "int", "int", "int", "int", "int", "int", "int");

dtp.enable();

util.debug("run: sudo dtrace -n 'testlibusdt*:::32probe{ printf(\"%d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d\", args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11], args[12], args[13], args[14], args[15], args[16], args[17], args[18], args[19], args[20], args[21], args[22], args[23], args[24], args[25], args[26], args[27], args[28], args[29], args[30], args[31]) }'")

var numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
               17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

setTimeout(function() { 

    var args = [];
    numbers.forEach(function(n) {
        args.push(n);
        dtp.fire("32probe", function(p) {
            return args;
        });
        p.fire(function(p) {
            return args;
        });
    });

}, 10000);
